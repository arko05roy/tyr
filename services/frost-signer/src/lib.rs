//! Shared types for tyr's FROST-authorized Zcash payouts (PRD 7.5, owner-approved fallback).
//!
//! zingolib cannot consume external spend-auth signatures (no PCZT path), so FROST does not sign
//! the Orchard/Ironwood spend itself. Instead 2-of-3 signers sign a canonical payout
//! *instruction*; the sidecar's hot wallet executes only instructions carrying a valid group
//! signature. Disclosed in docs/human-values.md.
pub use reddsa::frost::redpallas as frost;

use serde::{Deserialize, Serialize};

/// A payout the wallet may execute. Field order is the canonical signing order.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PayoutInstruction {
    pub v: u8,
    /// ZcashOrder id — signers refuse to sign the same receipt twice.
    pub receipt_id: String,
    /// recipient unified address
    pub to: String,
    pub zat: u64,
    /// memo text attached to the shielded payout (the receipt id)
    pub memo: String,
}

impl PayoutInstruction {
    /// Bytes every signer signs: domain tag ‖ compact JSON in struct field order.
    pub fn message(&self) -> Vec<u8> {
        let mut m = b"tyr.bet/zcash-payout/v1\0".to_vec();
        m.extend(serde_json::to_vec(self).expect("serializable"));
        m
    }
}

/// Signer policy shared by every share holder.
pub fn check_policy(ix: &PayoutInstruction, max_zat: u64) -> Result<(), String> {
    if ix.v != 1 {
        return Err(format!("unsupported instruction version {}", ix.v));
    }
    if ix.zat == 0 || ix.zat > max_zat {
        return Err(format!("amount {} zat outside (0, {max_zat}]", ix.zat));
    }
    if !(ix.to.starts_with("u1") || ix.to.starts_with("utest1") || ix.to.starts_with("uregtest1")) {
        return Err("recipient must be a unified address".into());
    }
    if ix.receipt_id.is_empty() || ix.receipt_id.len() > 64 || ix.memo.len() > 512 {
        return Err("bad receipt id or memo".into());
    }
    Ok(())
}

/// What `frost-keygen` writes for each signer (one file per container).
#[derive(Serialize, Deserialize)]
pub struct ShareFile {
    pub identifier: u16,
    pub key_package: String, // hex(KeyPackage::serialize)
}

/// Public group info: everyone (sidecar, verifiers) reads this.
#[derive(Serialize, Deserialize)]
pub struct GroupFile {
    pub min_signers: u16,
    pub max_signers: u16,
    pub public_key_package: String, // hex(PublicKeyPackage::serialize)
    pub verifying_key: String,      // hex(group verifying key)
}

pub fn identifier(i: u16) -> frost::Identifier {
    frost::Identifier::try_from(i).expect("non-zero identifier")
}

/// Verify an aggregated group signature on an instruction.
pub fn verify(group: &frost::keys::PublicKeyPackage, ix: &PayoutInstruction, sig_hex: &str) -> Result<(), String> {
    let bytes = hex::decode(sig_hex).map_err(|e| e.to_string())?;
    let sig = frost::Signature::deserialize(&bytes).map_err(|e| e.to_string())?;
    group.verifying_key().verify(&ix.message(), &sig).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn ix() -> PayoutInstruction {
        PayoutInstruction { v: 1, receipt_id: "r1".into(), to: "uregtest1abc".into(), zat: 1000, memo: "r1".into() }
    }

    fn sign_with(ids: &[u16]) -> Result<String, String> {
        let mut rng = rand_core::OsRng;
        let (shares, pubs) = frost::keys::generate_with_dealer(3, 2, frost::keys::IdentifierList::Default, &mut rng).unwrap();
        let mut nonces = BTreeMap::new();
        let mut commits = BTreeMap::new();
        let mut kps = BTreeMap::new();
        for id in ids {
            let id = identifier(*id);
            let kp = frost::keys::KeyPackage::try_from(shares[&id].clone()).unwrap();
            let (n, c) = frost::round1::commit(kp.signing_share(), &mut rng);
            nonces.insert(id, n);
            commits.insert(id, c);
            kps.insert(id, kp);
        }
        let pkg = frost::SigningPackage::new(commits, &ix().message());
        let mut sigs = BTreeMap::new();
        for (id, kp) in &kps {
            sigs.insert(*id, frost::round2::sign(&pkg, &nonces[id], kp).map_err(|e| e.to_string())?);
        }
        let sig = frost::aggregate(&pkg, &sigs, &pubs).map_err(|e| e.to_string())?;
        let hex = hex::encode(sig.serialize().unwrap());
        verify(&pubs, &ix(), &hex)?;
        Ok(hex)
    }

    #[test]
    fn two_of_three_signs() {
        assert!(sign_with(&[1, 3]).is_ok());
    }

    #[test]
    fn one_of_three_fails() {
        assert!(sign_with(&[2]).is_err());
    }

    #[test]
    fn policy() {
        assert!(check_policy(&ix(), 10_000).is_ok());
        assert!(check_policy(&PayoutInstruction { zat: 20_000, ..ix() }, 10_000).is_err());
        assert!(check_policy(&PayoutInstruction { to: "tm123".into(), ..ix() }, 10_000).is_err());
    }
}
