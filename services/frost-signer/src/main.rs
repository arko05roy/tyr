//! One FROST signer (PRD 7.5). Holds a single key share; runs in its own container.
//!   POST /round1 {instruction}              → {commitment}   (checks policy + replay first)
//!   POST /round2 {instruction, package}      → {share}        (only for a package over that instruction)
//! Env: FROST_SHARE_FILE, FROST_STATE_DIR (signed-receipt log), FROST_MAX_PAYOUT_ZAT, PORT.
use axum::{extract::State, http::StatusCode, routing::{get, post}, Json, Router};
use frost_payout::{check_policy, frost, PayoutInstruction, ShareFile};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::Mutex;

struct Signer {
    id: u16,
    key: frost::keys::KeyPackage,
    max_zat: u64,
    signed_log: PathBuf,
    /// receipt id → nonces from round 1 (one outstanding signing session per receipt)
    nonces: Mutex<HashMap<String, frost::round1::SigningNonces>>,
}

type Res = Result<Json<Value>, (StatusCode, String)>;
fn bad(e: impl ToString) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, e.to_string())
}

impl Signer {
    fn already_signed(&self, receipt: &str) -> bool {
        std::fs::read_to_string(&self.signed_log)
            .map(|s| s.lines().any(|l| l == receipt))
            .unwrap_or(false)
    }
}

#[derive(Deserialize)]
struct R1 {
    instruction: PayoutInstruction,
}

async fn round1(State(s): State<Arc<Signer>>, Json(r): Json<R1>) -> Res {
    check_policy(&r.instruction, s.max_zat).map_err(bad)?;
    if s.already_signed(&r.instruction.receipt_id) {
        return Err((StatusCode::CONFLICT, format!("receipt {} already signed", r.instruction.receipt_id)));
    }
    let (nonces, commitment) = frost::round1::commit(s.key.signing_share(), &mut rand_core::OsRng);
    s.nonces.lock().await.insert(r.instruction.receipt_id.clone(), nonces);
    Ok(Json(json!({ "identifier": s.id, "commitment": hex::encode(commitment.serialize().map_err(bad)?) })))
}

#[derive(Deserialize)]
struct R2 {
    instruction: PayoutInstruction,
    signing_package: String,
}

async fn round2(State(s): State<Arc<Signer>>, Json(r): Json<R2>) -> Res {
    check_policy(&r.instruction, s.max_zat).map_err(bad)?;
    let pkg = frost::SigningPackage::deserialize(&hex::decode(&r.signing_package).map_err(bad)?).map_err(bad)?;
    // Never sign a package whose message isn't exactly this instruction.
    if pkg.message() != r.instruction.message().as_slice() {
        return Err(bad("signing package message does not match instruction"));
    }
    let nonces = s
        .nonces
        .lock()
        .await
        .remove(&r.instruction.receipt_id)
        .ok_or_else(|| bad("no round1 commitment for this receipt"))?;
    let share = frost::round2::sign(&pkg, &nonces, &s.key).map_err(bad)?;
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&s.signed_log).map_err(bad)?;
    writeln!(f, "{}", r.instruction.receipt_id).map_err(bad)?;
    Ok(Json(json!({ "identifier": s.id, "share": hex::encode(share.serialize()) })))
}

#[tokio::main]
async fn main() {
    let env = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("{k} is required"));
    let file: ShareFile = serde_json::from_slice(&std::fs::read(env("FROST_SHARE_FILE")).unwrap()).unwrap();
    let key = frost::keys::KeyPackage::deserialize(&hex::decode(&file.key_package).unwrap()).unwrap();
    let state_dir = PathBuf::from(env("FROST_STATE_DIR"));
    std::fs::create_dir_all(&state_dir).unwrap();
    let signer = Arc::new(Signer {
        id: file.identifier,
        key,
        max_zat: env("FROST_MAX_PAYOUT_ZAT").parse().unwrap(),
        signed_log: state_dir.join(format!("signed-{}.log", file.identifier)),
        nonces: Mutex::new(HashMap::new()),
    });
    let id = signer.id;
    let app = Router::new()
        .route("/health", get(move || async move { Json(json!({ "ok": true, "identifier": id })) }))
        .route("/round1", post(round1))
        .route("/round2", post(round2))
        .with_state(signer);
    let port = std::env::var("PORT").unwrap_or_else(|_| "7100".into());
    let l = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await.unwrap();
    eprintln!("frost signer {id} listening on {port}");
    axum::serve(l, app).await.unwrap();
}
