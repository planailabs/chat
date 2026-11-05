//! Connector secrets at rest: ChaCha20-Poly1305 with the key from
//! `[secrets].connector_encryption_key`. Each value is bound to where it is
//! stored (the associated data names the row and column), so a ciphertext
//! copied into another row doesn't decrypt.
//!
//! Layout: `0x01 ‖ 12-byte random nonce ‖ ciphertext ‖ 16-byte tag`.

use ring::aead::{Aad, CHACHA20_POLY1305, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use ring::rand::{SecureRandom, SystemRandom};

const VERSION: u8 = 1;

pub struct Crypto {
    key: LessSafeKey,
    rng: SystemRandom,
}

impl Crypto {
    pub fn new(key: &[u8; 32]) -> Self {
        let key = LessSafeKey::new(UnboundKey::new(&CHACHA20_POLY1305, key).expect("a 32-byte ChaCha20-Poly1305 key"));
        Self { key, rng: SystemRandom::new() }
    }

    pub fn seal(&self, aad: &str, plain: &str) -> Vec<u8> {
        let mut nonce = [0u8; NONCE_LEN];
        self.rng.fill(&mut nonce).expect("the OS random number generator");
        let mut buf = plain.as_bytes().to_vec();
        self.key
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(aad.as_bytes()), &mut buf)
            .expect("sealing never fails for in-memory sizes");
        let mut out = Vec::with_capacity(1 + NONCE_LEN + buf.len());
        out.push(VERSION);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&buf);
        out
    }

    pub fn open(&self, aad: &str, sealed: &[u8]) -> anyhow::Result<String> {
        anyhow::ensure!(sealed.len() > 1 + NONCE_LEN && sealed[0] == VERSION, "not a sealed connector secret");
        let nonce: [u8; NONCE_LEN] = sealed[1..1 + NONCE_LEN].try_into().expect("length checked");
        let mut buf = sealed[1 + NONCE_LEN..].to_vec();
        let plain = self
            .key
            .open_in_place(Nonce::assume_unique_for_key(nonce), Aad::from(aad.as_bytes()), &mut buf)
            .map_err(|_| anyhow::anyhow!("a stored connector secret doesn't decrypt (wrong [secrets].connector_encryption_key?)"))?;
        Ok(String::from_utf8(plain.to_vec())?)
    }
}

#[cfg(test)]
mod tests {
    use super::Crypto;

    #[test]
    fn sealed_values_open_only_where_they_were_stored() {
        let c = Crypto::new(&[7; 32]);
        let sealed = c.seal("connector-bearer:1", "s3cret-token");
        assert!(!sealed.windows(6).any(|w| w == b"s3cret"), "no plaintext at rest");
        assert_eq!(c.open("connector-bearer:1", &sealed).unwrap(), "s3cret-token");
        assert!(c.open("connector-bearer:2", &sealed).is_err(), "bound to its row");
        assert!(Crypto::new(&[8; 32]).open("connector-bearer:1", &sealed).is_err(), "bound to the key");
        assert_ne!(c.seal("a", "x"), c.seal("a", "x"), "fresh nonce each time");
    }
}
