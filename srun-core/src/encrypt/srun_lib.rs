//! srun_lib - XXTEA 变体（xEncode）与自定义 Base64
//!
//! 对应 Python `srun/srun_lib.py`，匹配 Portal.js 的 `s()` / `l()` / `encode()`。
//! 步骤 5 仅实现 `x_encode`，步骤 6 在本文件追加 `base64_encode`。

/// XXTEA 算法的 delta 常数（对应 Python `XXTEA_DELTA`）
const DELTA: u32 = 0x9E3779B9;

/// 对应 Python `_xxtea_str_to_words`：把字节切片按 4 字节小端打包成 u32 数组。
///
/// `append_len=true` 时在末尾追加原始字节长度（深澜 xEncode 用于明文长度校验，
/// 解密时按该长度截断尾部填充）。
fn xxtea_str_to_words(data: &[u8], append_len: bool) -> Vec<u32> {
    let n = data.len();
    let word_count = (n + 3) / 4;
    let mut words = vec![0u32; word_count];
    for (i, &b) in data.iter().enumerate() {
        words[i >> 2] |= (b as u32) << ((i % 4) * 8);
    }
    if append_len {
        words.push(n as u32);
    }
    words
}

/// 对应 Python `_xxtea_words_to_bytes`：每个 u32 按小端拆成 4 字节
fn xxtea_words_to_bytes(words: &[u32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(words.len() * 4);
    for &w in words {
        out.extend_from_slice(&w.to_le_bytes());
    }
    out
}

/// 深澜 xEncode（XXTEA 变体），对应 Python `x_encode(data, key)`
///
/// 关键实现细节：
/// - 所有加法用 `wrapping_add` 模拟 JS `>>>0` 截断语义；debug 模式默认
///   panic on overflow 会破坏算法正确性，必须显式 wrapping。
/// - `<<` / `>>` / `^` 在 u32 上天然按 32 位截断，与 Python `_u32(<<)` 等价。
/// - 空数据短路返回空 `Vec<u8>`，避免后续 `v[n]` 越界。
pub fn x_encode(data: &[u8], key: &[u8]) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }
    let mut v = xxtea_str_to_words(data, true);
    let mut k = xxtea_str_to_words(key, false);
    while k.len() < 4 {
        k.push(0);
    }
    let n = v.len() - 1;
    if n < 1 {
        // data 非空时 v 至少 2 个元素（明文 + 长度），此分支理论上不会进入，
        // 保留以防未来 append_len 改为 false 时退化。
        return xxtea_words_to_bytes(&v);
    }
    let mut z = v[n];
    let mut y = v[0];
    let n_u32 = n as u32;
    let q = 6 + 52 / (n_u32 + 1);
    let mut d: u32 = 0;
    for _ in 0..q {
        d = d.wrapping_add(DELTA);
        let e = (d >> 2) & 3;
        for p in 0..n {
            let p_u32 = p as u32;
            y = v[p + 1];
            let mut m = (z >> 5) ^ (y << 2);
            m = m.wrapping_add((y >> 3) ^ (z << 4) ^ (d ^ y));
            m = m.wrapping_add(k[(((p_u32 & 3) ^ e) as usize)] ^ z);
            z = v[p].wrapping_add(m);
            v[p] = z;
        }
        y = v[0];
        let mut m = (z >> 5) ^ (y << 2);
        m = m.wrapping_add((y >> 3) ^ (z << 4) ^ (d ^ y));
        m = m.wrapping_add(k[(((n_u32 & 3) ^ e) as usize)] ^ z);
        z = v[n].wrapping_add(m);
        v[n] = z;
    }
    xxtea_words_to_bytes(&v)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 空数据应短路返回空 `Vec<u8>`，避免后续 `v[n]` 越界
    #[test]
    fn x_encode_empty_data_returns_empty() {
        assert!(x_encode(b"", b"token").is_empty());
    }

    /// 输出长度公式 `((L+3)/4 + 1) * 4`，对应 Python `_xxtea_str_to_words(_, true)` 后
    /// 追加 1 个长度字 + 每 u32 拆 4 字节小端
    #[test]
    fn x_encode_length_formula() {
        let key = b"token";
        for (input_len, expected) in [
            (1usize, 8usize),
            (4, 8),
            (5, 12),
            (8, 12),
            (16, 20),
        ] {
            let data = vec![0u8; input_len];
            let out = x_encode(&data, key);
            assert_eq!(out.len(), expected, "input_len={input_len}");
        }
    }

    /// 黄金向量由 Python `srun-campus-network-main` 跑得，确保 Rust 实现与之字节级一致。
    /// 命令：`python -c "from srun.srun_lib import x_encode; print(x_encode(b'abc', b'token').hex())"`
    #[test]
    fn x_encode_golden_abc_token() {
        let out = x_encode(b"abc", b"token");
        let expected = hex::decode("723c6bd44e430443").unwrap();
        assert_eq!(out, expected);
    }

    /// 黄金向量：`x_encode(b'hello', b'world')`
    #[test]
    fn x_encode_golden_hello_world() {
        let out = x_encode(b"hello", b"world");
        let expected = hex::decode("bb555ab502d14df680522cc4").unwrap();
        assert_eq!(out, expected);
    }

    /// 黄金向量：`x_encode(b'a', b'k')`（1 字节 → 8 字节输出）
    #[test]
    fn x_encode_golden_a_k() {
        let out = x_encode(b"a", b"k");
        let expected = hex::decode("10d188dc61522d85").unwrap();
        assert_eq!(out, expected);
    }

    /// 黄金向量：`x_encode(b'abcd', b'k')`（4 字节 → 8 字节输出，无填充）
    #[test]
    fn x_encode_golden_abcd_k() {
        let out = x_encode(b"abcd", b"k");
        let expected = hex::decode("bc335d505156065e").unwrap();
        assert_eq!(out, expected);
    }

    /// 黄金向量：`x_encode(b'abcde', b'k')`（5 字节 → 12 字节输出，含 1 个填充 word）
    #[test]
    fn x_encode_golden_abcde_k() {
        let out = x_encode(b"abcde", b"k");
        let expected = hex::decode("2aa69c32b961ab410eb7cda8").unwrap();
        assert_eq!(out, expected);
    }

    /// 短密钥（<4 字节）应自动补 0 至 4 字，行为与 Python 一致
    #[test]
    fn x_encode_short_key_padded_to_4_words() {
        // 密钥 "k"（1 字节）等价于 [0x6b, 0, 0, 0]
        let out_short = x_encode(b"data", b"k");
        let out_padded = x_encode(b"data", b"k\x00\x00\x00");
        assert_eq!(out_short, out_padded);
    }

    /// 输出应在多次调用下保持稳定（确定性）
    #[test]
    fn x_encode_is_deterministic() {
        let a = x_encode(b"stable", b"key");
        let b = x_encode(b"stable", b"key");
        assert_eq!(a, b);
    }
}
