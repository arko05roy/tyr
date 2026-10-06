//! PRD 7.2 — tyr order memo codec (Rust twin of packages/zcash/src/memo.ts).
//!
//! Binary v1 (big-endian):
//!   version u8 = 1 | outcome u32 | side u8 (0 yes, 1 no) | sizeCents u32 |
//!   uaLen u8 | returnUA (ascii) | nonce [8] | checksum [4] = sha256(all prior bytes)[0..4]
//! Carried as a text memo: "tyr1:" + base64url(binary, no padding). ≤ 512 bytes.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

pub const PREFIX: &str = "tyr1:";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderMemo {
    pub outcome: u32,
    pub side: u8,
    pub size_cents: u32,
    pub return_ua: String,
    pub nonce: [u8; 8],
}

pub fn encode(m: &OrderMemo) -> Result<String, String> {
    if m.side > 1 {
        return Err("side must be 0 or 1".into());
    }
    let ua = m.return_ua.as_bytes();
    if ua.is_empty() || ua.len() > 255 || !m.return_ua.is_ascii() {
        return Err("return UA must be 1..255 ascii bytes".into());
    }
    let mut b = vec![1u8];
    b.extend(m.outcome.to_be_bytes());
    b.push(m.side);
    b.extend(m.size_cents.to_be_bytes());
    b.push(ua.len() as u8);
    b.extend(ua);
    b.extend(m.nonce);
    let sum = Sha256::digest(&b);
    b.extend(&sum[..4]);
    let text = format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(&b));
    if text.len() > 512 {
        return Err("memo exceeds 512 bytes".into());
    }
    Ok(text)
}

pub fn decode(text: &str) -> Result<OrderMemo, String> {
    let body = text.trim_end_matches('\0').strip_prefix(PREFIX).ok_or("not a tyr memo")?;
    let b = URL_SAFE_NO_PAD.decode(body).map_err(|e| e.to_string())?;
    if b.len() < 1 + 4 + 1 + 4 + 1 + 8 + 4 {
        return Err("memo too short".into());
    }
    let (payload, sum) = b.split_at(b.len() - 4);
    if &Sha256::digest(payload)[..4] != sum {
        return Err("bad checksum".into());
    }
    if payload[0] != 1 {
        return Err(format!("unsupported memo version {}", payload[0]));
    }
    let u32_at = |i: usize| u32::from_be_bytes(payload[i..i + 4].try_into().unwrap());
    let side = payload[5];
    if side > 1 {
        return Err("bad side".into());
    }
    let ua_len = payload[10] as usize;
    if payload.len() != 11 + ua_len + 8 {
        return Err("length mismatch".into());
    }
    let return_ua = String::from_utf8(payload[11..11 + ua_len].to_vec()).map_err(|e| e.to_string())?;
    Ok(OrderMemo {
        outcome: u32_at(1),
        side,
        size_cents: u32_at(6),
        return_ua,
        nonce: payload[11 + ua_len..].try_into().unwrap(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Vector {
        outcome: u32,
        side: u8,
        #[serde(rename = "sizeCents")]
        size_cents: u32,
        #[serde(rename = "returnUA")]
        return_ua: String,
        nonce: String,
        memo: String,
    }
    #[derive(Deserialize)]
    struct Vectors {
        valid: Vec<Vector>,
        invalid: Vec<String>,
    }

    /// Shared with the TS codec (packages/zcash/test/memo-vectors.json).
    #[test]
    fn shared_vectors() {
        let v: Vectors =
            serde_json::from_str(include_str!("../../../packages/zcash/test/memo-vectors.json")).unwrap();
        for t in v.valid {
            let m = OrderMemo {
                outcome: t.outcome,
                side: t.side,
                size_cents: t.size_cents,
                return_ua: t.return_ua,
                nonce: hex::decode(&t.nonce).unwrap().try_into().unwrap(),
            };
            assert_eq!(encode(&m).unwrap(), t.memo);
            assert_eq!(decode(&t.memo).unwrap(), m);
        }
        for bad in v.invalid {
            assert!(decode(&bad).is_err(), "{bad} should not decode");
        }
    }
}
