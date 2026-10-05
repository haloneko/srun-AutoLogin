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
