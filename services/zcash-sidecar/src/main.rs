//! PRD 7.1 — tyr's Zcash wallet sidecar. Wraps a zingolib LightClient behind a local HTTP API.
//!
//! Roles (SIDECAR_ROLE):
//!   tyr  — tyr's order-receiving wallet. Spends ONLY through POST /payout, which requires a
//!          2-of-3 FROST group signature over the payout instruction (PRD 7.5 fallback, owner
//!          approved 2026-10-06: zingolib has no external spend-auth signing path).
//!   user — a test user's wallet (stands in for the user's own Zcash app): POST /send pays a
//!          ZIP-321 URI exactly as a wallet app would after scanning tyr's QR.
//!
//! Env: SIDECAR_ROLE, WALLET_DIR, INDEXER_URI, PORT, and for tyr: FROST_GROUP_FILE,
//! FROST_SIGNERS (comma-separated signer base URLs, identifiers 1..n in order).
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use frost_payout::{GroupFile, PayoutInstruction, frost, identifier, verify};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf, str::FromStr, sync::Arc, time::Duration};
use tokio::sync::Mutex;
use zcash_address::ZcashAddress;
use zcash_client_backend::zip321::{Payment, TransactionRequest};
use zcash_protocol::{
    memo::{Memo, MemoBytes},
    value::Zatoshis,
};
use zingo_status::confirmation_status::ConfirmationStatus;
use zingolib::{
    config::{ChainType, ClientConfig, WalletConfig},
    lightclient::LightClient,
    perspective::value_transfer::ValueTransferKind,
};

struct App {
    role: String,
    client: Mutex<LightClient>,
    frost: Option<Frost>,
    http: reqwest::Client,
}

struct Frost {
    group: frost::keys::PublicKeyPackage,
    verifying_key: String,
    signers: Vec<String>,
}

type Res = Result<Json<Value>, (StatusCode, String)>;
fn err(code: StatusCode, e: impl ToString) -> (StatusCode, String) {
    (code, e.to_string())
}
fn bad(e: impl ToString) -> (StatusCode, String) {
    err(StatusCode::BAD_REQUEST, e)
}
fn internal(e: impl std::fmt::Debug) -> (StatusCode, String) {
    err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:?}"))
}

async fn sync(c: &mut LightClient) -> Result<u32, String> {
    let r = c.sync_to_tip_and_await().await.map_err(|e| format!("{e:?}"))?;
    Ok(u32::from(r.sync_end_height))
}

async fn first_ua(c: &LightClient) -> String {
    let j = c.unified_addresses_json().await;
    j[0]["encoded_address"].as_str().or(j[0]["address"].as_str()).unwrap_or_default().to_string()
}

async fn health(State(a): State<Arc<App>>) -> Res {
    let c = a.client.lock().await;
    Ok(Json(json!({ "role": a.role, "address": first_ua(&c).await })))
}

async fn address(State(a): State<Arc<App>>) -> Res {
    Ok(Json(json!({ "address": first_ua(&*a.client.lock().await).await })))
}

async fn do_sync(State(a): State<Arc<App>>) -> Res {
    let h = sync(&mut *a.client.lock().await).await.map_err(internal)?;
    Ok(Json(json!({ "height": h })))
}

/// Received value transfers with their decrypted memos (tyr's IVK scan; PRD 7.4 input).
async fn incoming(State(a): State<Arc<App>>) -> Res {
    let c = a.client.lock().await;
    let vts = c.value_transfers(false).await.map_err(internal)?;
    let mut out = vec![];
    for vt in vts.iter() {
        if !matches!(vt.kind, ValueTransferKind::Received) {
            continue;
        }
        let (confirmed, height) = match vt.status {
            ConfirmationStatus::Confirmed(h) => (true, u32::from(h)),
            other => (false, u32::from(other.get_height())),
        };
        out.push(json!({
            "txid": vt.txid.to_string(),
            "value": vt.value,
            "height": height,
            "confirmed": confirmed,
            "memos": vt.memos,
        }));
    }
    Ok(Json(json!({ "transfers": out })))
}

#[derive(Deserialize)]
struct TxidQuery {
    txid: String,
}

/// PRD 7.7 — per-tx view of ONE payout: tyr's wallet decrypts its own outgoing outputs (OVK) for
/// that txid only. Nothing about other transactions is revealed.
async fn outgoing(State(a): State<Arc<App>>, axum::extract::Query(q): axum::extract::Query<TxidQuery>) -> Res {
    let c = a.client.lock().await;
    let vts = c.value_transfers(false).await.map_err(internal)?;
    let outputs: Vec<Value> = vts
        .iter()
        .filter(|vt| vt.txid.to_string() == q.txid && matches!(vt.kind, ValueTransferKind::Sent(_)))
        .map(|vt| {
            json!({
                "recipient": vt.recipient_address,
                "value": vt.value,
                "memos": vt.memos,
                "confirmed": matches!(vt.status, ConfirmationStatus::Confirmed(_)),
                "height": u32::from(vt.status.get_height()),
                "fee": vt.transaction_fee,
            })
        })
        .collect();
    if outputs.is_empty() {
        return Err(err(StatusCode::NOT_FOUND, "no outgoing outputs for that txid"));
    }
    Ok(Json(json!({ "txid": q.txid, "outputs": outputs })))
}

/// Public FROST group info + verification of a signed payout instruction (PRD 7.7 / 10.2).
async fn frost_group(State(a): State<Arc<App>>) -> Res {
    let f = a.frost.as_ref().ok_or_else(|| bad("FROST not configured"))?;
    Ok(Json(json!({ "min_signers": 2, "max_signers": f.signers.len(), "verifying_key": f.verifying_key })))
}

#[derive(Deserialize)]
struct VerifyReq {
    instruction: PayoutInstruction,
    signature: String,
}

async fn frost_verify(State(a): State<Arc<App>>, Json(b): Json<VerifyReq>) -> Res {
    let f = a.frost.as_ref().ok_or_else(|| bad("FROST not configured"))?;
    let valid = verify(&f.group, &b.instruction, &b.signature).is_ok();
    Ok(Json(json!({ "valid": valid, "verifying_key": f.verifying_key })))
}

async fn send_request(c: &mut LightClient, req: TransactionRequest) -> Result<Vec<String>, String> {
    let txids = c
        .quick_send(req, zip32::AccountId::ZERO, true)
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(txids.iter().map(|t| t.to_string()).collect())
}

#[derive(Deserialize)]
struct SendUri {
    uri: String,
}

/// user role only: pay a ZIP-321 request (what a wallet app does after scanning the QR).
async fn send_uri(State(a): State<Arc<App>>, Json(b): Json<SendUri>) -> Res {
    if a.role != "user" {
        return Err(err(StatusCode::FORBIDDEN, "tyr wallet spends only via FROST-authorized /payout"));
    }
    let req = TransactionRequest::from_uri(&b.uri).map_err(|e| bad(format!("{e:?}")))?;
    let txids = send_request(&mut *a.client.lock().await, req).await.map_err(internal)?;
    Ok(Json(json!({ "txids": txids })))
}

/// Coordinator: round1 at each chosen signer → signing package → round2 → aggregate → verify.
async fn frost_sign(a: &App, ix: &PayoutInstruction, ids: &[u16]) -> Result<String, (StatusCode, String)> {
    let f = a.frost.as_ref().ok_or_else(|| bad("FROST not configured"))?;
    let url = |id: u16| {
        f.signers
            .get(id as usize - 1)
            .cloned()
            .ok_or_else(|| bad(format!("unknown signer {id}")))
    };
    let post = |u: String, body: Value| {
        let http = a.http.clone();
        async move {
            let r = http.post(u).json(&body).send().await.map_err(|e| err(StatusCode::BAD_GATEWAY, e))?;
            let status = r.status();
            let text = r.text().await.map_err(|e| err(StatusCode::BAD_GATEWAY, e))?;
            if !status.is_success() {
                return Err(err(StatusCode::BAD_GATEWAY, format!("signer refused ({status}): {text}")));
            }
            serde_json::from_str::<Value>(&text).map_err(|e| err(StatusCode::BAD_GATEWAY, e))
        }
    };
    let field = |v: &Value, k: &str| -> Result<Vec<u8>, (StatusCode, String)> {
        hex::decode(v[k].as_str().unwrap_or_default()).map_err(|e| err(StatusCode::BAD_GATEWAY, e))
    };

    let mut commitments = BTreeMap::new();
    for &id in ids {
        let r = post(format!("{}/round1", url(id)?), json!({ "instruction": ix })).await?;
        let c = frost::round1::SigningCommitments::deserialize(&field(&r, "commitment")?)
            .map_err(|e| err(StatusCode::BAD_GATEWAY, e))?;
        commitments.insert(identifier(id), c);
    }
    let pkg = frost::SigningPackage::new(commitments, &ix.message());
    let pkg_hex = hex::encode(pkg.serialize().map_err(internal)?);
    let mut shares = BTreeMap::new();
    for &id in ids {
        let r = post(
            format!("{}/round2", url(id)?),
            json!({ "instruction": ix, "signing_package": pkg_hex }),
        )
        .await?;
        let s = frost::round2::SignatureShare::deserialize(&field(&r, "share")?)
            .map_err(|e| err(StatusCode::BAD_GATEWAY, e))?;
        shares.insert(identifier(id), s);
    }
    let sig = frost::aggregate(&pkg, &shares, &f.group)
        .map_err(|e| err(StatusCode::UNPROCESSABLE_ENTITY, format!("aggregate failed: {e}")))?;
    let sig_hex = hex::encode(sig.serialize().map_err(internal)?);
    verify(&f.group, ix, &sig_hex).map_err(|e| err(StatusCode::UNPROCESSABLE_ENTITY, e))?;
    Ok(sig_hex)
}

#[derive(Deserialize)]
struct SignReq {
    instruction: PayoutInstruction,
    #[serde(default)]
    signers: Option<Vec<u16>>,
}

/// Sign only (no spend) — used by frost.test.ts to show 2-of-3 works and 1-of-3 doesn't.
async fn sign_only(State(a): State<Arc<App>>, Json(b): Json<SignReq>) -> Res {
    let ids = b.signers.unwrap_or_else(|| vec![1, 2]);
    let sig = frost_sign(&a, &b.instruction, &ids).await?;
    Ok(Json(json!({ "signature": sig, "signers": ids })))
}

/// PRD 7.6 — shielded payout to the order's return UA with memo = receipt id. Executes only
/// with a valid FROST group signature; tries signer pairs until one pair agrees.
async fn payout(State(a): State<Arc<App>>, Json(b): Json<SignReq>) -> Res {
    if a.role != "tyr" {
        return Err(err(StatusCode::FORBIDDEN, "payout is a tyr-role endpoint"));
    }
    let ix = b.instruction;
    let n = a.frost.as_ref().map(|f| f.signers.len() as u16).unwrap_or(0);
    let pairs: Vec<Vec<u16>> = match b.signers {
        Some(ids) => vec![ids],
        None => (1..=n).flat_map(|i| ((i + 1)..=n).map(move |j| vec![i, j])).collect(),
    };
    let mut last = None;
    let mut signed = None;
    for ids in pairs {
        match frost_sign(&a, &ix, &ids).await {
            Ok(sig) => {
                signed = Some((sig, ids));
                break;
            }
            // A signer that already signed this receipt (CONFLICT) means a payout may already
            // exist — never retry with other signers in that case.
            Err(e) if e.1.contains("already signed") => return Err(err(StatusCode::CONFLICT, e.1)),
            Err(e) => last = Some(e),
        }
    }
    let (sig, ids) = signed.ok_or_else(|| last.unwrap_or_else(|| bad("no signers")))?;
    let f = a.frost.as_ref().expect("checked");
    verify(&f.group, &ix, &sig).map_err(|e| err(StatusCode::UNPROCESSABLE_ENTITY, e))?;

    let to = ZcashAddress::try_from_encoded(&ix.to).map_err(bad)?;
    let amount = Zatoshis::from_u64(ix.zat).map_err(|e| bad(format!("{e:?}")))?;
    let memo = MemoBytes::from(Memo::from_str(&ix.memo).map_err(|e| bad(format!("{e:?}")))?);
    let pay = Payment::new(to, Some(amount), Some(memo), None, None, vec![]).map_err(|e| bad(format!("{e:?}")))?;
    let req = TransactionRequest::new(vec![pay]).map_err(|e| bad(format!("{e:?}")))?;
    let mut c = a.client.lock().await;
    sync(&mut c).await.map_err(internal)?;
    let txids = send_request(&mut c, req).await.map_err(internal)?;
    Ok(Json(json!({ "txids": txids, "signature": sig, "signers": ids })))
}

#[tokio::main]
async fn main() {
    let env = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("{k} is required"));
    let role = env("SIDECAR_ROLE");
    assert!(role == "tyr" || role == "user", "SIDECAR_ROLE must be tyr or user");
    let indexer: http::Uri = env("INDEXER_URI").parse().expect("INDEXER_URI");
    let chain = ChainType::try_from(std::env::var("ZCASH_CHAIN").unwrap_or_else(|_| "regtest".into()).as_str())
        .expect("ZCASH_CHAIN");
    let config = ClientConfig::builder()
        .set_chain_type(chain)
        .set_wallet_dir(PathBuf::from(env("WALLET_DIR")))
        .set_wallet_config(WalletConfig::Read)
        .set_indexer_uri(indexer)
        .build()
        .expect("client config");
    let mut client = LightClient::new(config, false).await.expect("load wallet");
    client.save_task().await;
    let h = sync(&mut client).await.expect("initial sync");
    eprintln!("[{role}] wallet synced to {h}, address {}", first_ua(&client).await);

    let frost = if role == "tyr" {
        let g: GroupFile = serde_json::from_slice(&std::fs::read(env("FROST_GROUP_FILE")).unwrap()).unwrap();
        let group = frost::keys::PublicKeyPackage::deserialize(&hex::decode(g.public_key_package).unwrap())
            .expect("group file");
        let signers = env("FROST_SIGNERS").split(',').map(|s| s.trim().trim_end_matches('/').to_string()).collect();
        Some(Frost { group, verifying_key: g.verifying_key, signers })
    } else {
        None
    };

    let app = Arc::new(App { role: role.clone(), client: Mutex::new(client), frost, http: reqwest::Client::new() });

    // Background scan: keep the wallet at the tip so /incoming sees new memos promptly.
    let bg = app.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            if let Err(e) = sync(&mut *bg.client.lock().await).await {
                eprintln!("sync error: {e}");
            }
        }
    });

    let router = Router::new()
        .route("/health", get(health))
        .route("/address", get(address))
        .route("/sync", post(do_sync))
        .route("/incoming", get(incoming))
        .route("/send", post(send_uri))
        .route("/frost/sign", post(sign_only))
        .route("/payout", post(payout))
        .route("/outgoing", get(outgoing))
        .route("/frost/group", get(frost_group))
        .route("/frost/verify", post(frost_verify))
        .with_state(app);
    let port = std::env::var("PORT").unwrap_or_else(|_| "7200".into());
    let l = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.unwrap();
    eprintln!("[{role}] zcash sidecar on 127.0.0.1:{port}");
    axum::serve(l, router).await.unwrap();
}
