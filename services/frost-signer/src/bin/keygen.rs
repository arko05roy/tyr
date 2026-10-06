//! Trusted-dealer 2-of-3 keygen (PRD 7.5). Writes one share file per signer container plus the
//! public group file. Usage: frost-keygen <out_dir>
use frost_payout::{frost, GroupFile, ShareFile};
use std::{fs, path::PathBuf};

fn main() {
    let out = PathBuf::from(std::env::args().nth(1).expect("usage: frost-keygen <out_dir>"));
    fs::create_dir_all(&out).unwrap();
    if out.join("group.json").exists() {
        eprintln!("{} already holds a group; refusing to overwrite", out.display());
        std::process::exit(1);
    }
    let (shares, pubs) =
        frost::keys::generate_with_dealer(3, 2, frost::keys::IdentifierList::Default, rand_core::OsRng)
            .expect("keygen");
    for (i, (_, share)) in shares.into_iter().enumerate() {
        let kp = frost::keys::KeyPackage::try_from(share).expect("valid share");
        let file = ShareFile { identifier: i as u16 + 1, key_package: hex::encode(kp.serialize().unwrap()) };
        let path = out.join(format!("signer{}.json", i + 1));
        fs::write(&path, serde_json::to_vec_pretty(&file).unwrap()).unwrap();
    }
    let vk = hex::encode(pubs.verifying_key().serialize().unwrap());
    let group = GroupFile {
        min_signers: 2,
        max_signers: 3,
        public_key_package: hex::encode(pubs.serialize().unwrap()),
        verifying_key: vk.clone(),
    };
    fs::write(out.join("group.json"), serde_json::to_vec_pretty(&group).unwrap()).unwrap();
    println!("group verifying key {vk}");
}
