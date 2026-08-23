# TeamSpeak 3 Client↔Server Voice Protocol — Implementation Spec

Implementation-grade reference for our native TypeScript reimplementation of a TS3
**full voice client** over UDP — no official SDK, no external process. This is the
document `Ts3ProtocolClient` and the `protocol/` layers are built against.

> **Byte-level warning:** do not trust any paraphrase (including this doc) for the
> crypto. Before shipping, diff `GetKeyNonce`, `SetSharedSecret` and the EAX MAC
> against TSLib and confirm with captured test vectors.

## Authoritative sources

Every non-obvious claim is cited inline to one of these:

- **RE-DOC** — ReSpeak RE doc: <https://github.com/ReSpeak/tsdeclarations/blob/master/ts3protocol.md>
- **TSLib** (C#, ground truth) — `Splamy/TS3AudioBot/TSLib/Full/` (`PacketType.cs`, `TsCrypt.cs`, `Packet.cs`), `TSLib/Commands/TsString.cs`, `TSLib/TsEnums.cs`, `TSLib/Audio/EncoderPipe.cs`
- **SDK codec constants** — `teamspeak/ts3client-pluginsdk/include/teamspeak/public_definitions.h`
- **tsclientlib** (Rust cross-check) — <https://github.com/ReSpeak/tsclientlib>
- **ts3j** (Java port of TSLib) — <https://github.com/Manevolent/ts3j>
- **HoneyBBQ/teamspeak-js** — the one existing pure-TS full-voice client — <https://github.com/HoneyBBQ/teamspeak-js>

Direction convention: **C2S** = client→server, **S2C** = server→client.

## 1. Transport

- UDP only; no TCP fallback for the full voice protocol. Default port **9987/udp**.
- IPv4 + IPv6. Resolution order: SRV `_ts3._udp.<domain>` → TSDNS → literal host:port.
- Total UDP payload capped at **500 bytes**. Max application data per packet:
  C2S 500−8(MAC)−5(header) = **487 B**; S2C 500−8−3 = **489 B**.
- Larger command data must be compressed and/or fragmented (§2.5). Voice is never
  fragmented — an Opus frame must fit one packet.

## 2. Low-level packet format

Wire layout: **`[ MAC(8) ][ Header ][ Data ]`**. MAC = 8-byte EAX tag (or the fake
signature for unencrypted packets).

**C2S header (5 B):** PacketID u16 BE (0–1), ClientID u16 BE (2–3), Type+Flags (4).
**S2C header (3 B):** PacketID u16 BE (0–1), Type+Flags (2). *ClientID exists only C2S*
(0 during Init1/handshake, assigned by `initserver`).

### 2.2 Type+Flags byte — flags high nibble, type low 4 bits

```
bit:  7    6    5    4    3 2 1 0
      UE   CP   NP   FR   [ type ]
```

| Flag | Value | Meaning |
|---|---|---|
| Fragmented (FR) | 0x10 | fragment of a split command |
| Newprotocol (NP) | 0x20 | ≥3.1 "new protocol" marker |
| Compressed (CP) | 0x40 | data is QuickLZ-compressed |
| Unencrypted (UE) | 0x80 | data not EAX-encrypted (uses fake MAC) |

### 2.3 Packet types (`PacketType : byte`, TSLib)

| Type | ID | Reliable? | Encrypted | Splittable | Compressible |
|---|---|---|---|---|---|
| Voice | 0x0 | No | Optional | No | No |
| VoiceWhisper | 0x1 | No | Optional | No | No |
| Command | 0x2 | **Yes → Ack** | Yes | Yes | Yes |
| CommandLow | 0x3 | **Yes → AckLow** | Yes | Yes | Yes |
| Ping | 0x4 | (Pong replies) | No | No | No |
| Pong | 0x5 | No | No | No | No |
| Ack | 0x6 | No | Yes | No | No |
| AckLow | 0x7 | No | Yes | No | No |
| Init1 | 0x8 | Yes (own retransmit) | No | No | No |

### 2.4 Packet-ID & generation counters

- Each **(direction, packet type)** pair has its own u16 counter, starting at **1**,
  +1 per packet (including each fragment). Init1 uses fixed id 101.
- On `65535 → 0` wrap, a per-(direction,type) **u32 generation counter** increments
  and applies to the wrapping packet itself.
- The generation is **never transmitted** — an implicit shared value used only in
  key/nonce derivation (§4.6). A single missed wrap desyncs all later decryption.

### 2.5 Fragmentation & compression (Command/CommandLow only)

- Compression: **QuickLZ level 1, streaming mode 0**; set CP if it shrinks.
- Fragmentation: set **FR on first and last** fragment; CP/UE are meaningful only on
  the first (describe the whole reassembled payload); NP on all fragments; each
  fragment has its own id and Ack. Reassemble by concatenating between the two FR
  packets, then QuickLZ-decompress if CP was set on the first.

## 3. Connection handshake — low-level Init1 (packet 0..4)

All five Init1 packets are **unencrypted**, MAC = fixed `"TS3INIT1"`, PacketID 101,
ClientID 0. Client version field (first 4 B of C2S init) = `unixSeconds − 1356998400`
BE of a known accepted build.

| Step | Dir | Payload |
|---|---|---|
| packet 0 | C2S | `version(4)` + `0x00` + `timestamp(4)` + `randomA0(4)` + `zeros(8)` |
| packet 1 | S2C | `0x01` + `A1(16)` + `A0-reversed(4)` |
| packet 2 | C2S | `version(4)` + `0x02` + `A1(16)` + `A0r(4)` |
| packet 3 | S2C | `0x03` + RSA `x(64)` + RSA `n(64)` + `level(4 u32)` + `A2(100)` |
| packet 4 | C2S | `version(4)` + `0x04` + `x(64)` + `n(64)` + `level(4)` + `A2(100)` + RSA solution `y(64)` + `clientinitiv` command bytes |

**RSA puzzle (proof-of-work):** `y = x^(2^level) mod n` (repeated modular squaring of
64-byte `x` mod 64-byte `n`, `2^level` times); `y` big-endian, left-padded to 64 B.
`level` is server-chosen anti-DoS cost. If the server answers packet 2 with step
`0x7F` (127), restart the connect. Packet 4's trailing bytes carry the first command,
`clientinitiv`, moving into the crypto handshake (encrypted with the fake key until
the shared secret is set).

## 4. Cryptography (highest risk — quote TSLib verbatim when implementing)

### 4.1 Identity

- Curve: **NIST P-256 / secp256r1 / prime256v1** — ECDH+ECDSA. **Not** ed25519. (Curve25519
  appears only in the ≥3.1 license path, §4.5.)
- Identity = permanent P-256 keypair; public key exported as ASN.1 DER (`omega`), base64.
  **`omega` is TeamSpeak's LibTomCrypt layout, _not_ SPKI** (verbatim from TSLib
  `TsCrypt.ExportPublicKey`): `SEQUENCE { BIT STRING(0x00, 7 unused bits), INTEGER 32,
  INTEGER affineX, INTEGER affineY }`; the importer reads X at index 2, Y at index 3.
  Using SPKI here makes the server reject the key **and** overflows Init1 packet 4 past
  the 500-byte MTU — the compact form (~108 b64 chars) is required. Implemented in
  `crypto/Ts3Identity` (`omega()` / `sharedSecretX()`).
- `UID = base64( SHA1( base64(publicKeyDER) ) )`.
- **Security level / hashcash:** find decimal `keyOffset` so that
  `level = leading-zero *bits* of SHA1( base64(pubDER) + asciiDecimal(keyOffset) )`
  meets target (bits counted LSB-first per byte over the 20-byte hash).
- **Identity-file de-obfuscation:** stored as `keyOffset + "V" + base64(obf)`; decode:
  `ident = b64decode`; `sha = SHA1(ident[20 .. firstNull])`; `ident[0..20] ^= sha`;
  `ident[0..min(len,100)] ^= STATIC_KEY` where `STATIC_KEY` (hex) =
  `b9dfaa7bee6ac57ac7b65f1094a1c155e747327bc2fe5d51c512023fe54a280201004e90ad1daaae1075d53b7d571c30e063b5a62a4a017bb394833aa0983e6e`.

### 4.2 Handshake command exchange

1. **C2S `clientinitiv`** (on Init1 packet 4): `alpha`=b64(10 random B), `omega`=b64(identity
   pubkey DER), `ot=1`, `ip`=dialed server address.
2. **S2C** — old (<3.1) `initivexpand alpha= beta= omega=` (`beta`=b64 10 random B); new
   (≥3.1) `initivexpand2 l={license} beta(54B) omega= ot=1 proof= tvd=`.
3. Verify server `proof` (ECDSA-P256-SHA256 over license) against server `omega`; derive
   shared secret (§4.4/4.5).
4. **New protocol only** — C2S `clientek ek={ephemeralPub} proof={ecdsaSign(ek||beta)}`;
   **regular packet-ID counting starts here** (clientek = command id 1).
5. **C2S `clientinit`** (§5) → **S2C `initserver`** delivers your Client ID.

### 4.3 Fake key/nonce (before shared secret is set)

`DummyKeyAndNonceString = "c:\windows\system\firewall32.cpl"` (32 chars) →
`DummyKey = "c:\windows\syste"` (16 B), `DummyIv = "m\firewall32.cpl"` (16 B). While
`CryptoInitComplete == false`, every packet is EAX-encrypted with `(DummyKey,DummyIv)`
(packet-id XOR into key still applies). That is why `clientinitiv`/`initivexpand` are
"encrypted" yet trivially readable.

### 4.4 Shared secret / SharedIV — old protocol (<3.1)

```
P = serverPublicPoint * identityPrivateKey ; Normalize()
x = P.AffineX as BE bytes, fixed to 32 B
sharedKey = SHA1(x)                              // 20 B

ivStruct = new byte[10 + beta.length]            // 20 old
ivStruct[0..10]        = sharedKey[0..10] XOR alpha[0..10]
ivStruct[10..10+betaL] = sharedKey[10..]  XOR beta[0..betaL]
fakeSignature = SHA1(ivStruct)[0..8]             // 8-B MAC for unencrypted packets
```

SharedIV = `ivStruct`, length **20** (old). `fakeSignature` is the fixed MAC on
unencrypted packets (Voice/Ping/Pong) via `FakeEncrypt`.

### 4.5 Shared secret — new protocol (≥3.1)

Server sends a **license chain** (`l=`). Walk blocks from the fixed root key, combine
with the client's ephemeral Curve25519 key (`clientek`):

```
ROOT = cd0de2aed46345509a7e3cfd8f68b3dc7555b29dccec73cd18750f993812408a  // 32 B
for each license block:
    scalar   = clamp( SHA512(block[1..])[0..32] )
    next_key = block.publicKey * scalar + parent_key    // Curve25519 group op
sharedData      = final_next_key * clientEphemeralPrivate
ivStruct[0..64] = SHA512(sharedData)                    // 64 B
ivStruct[0..10]  ^= alpha
ivStruct[10..64] ^= beta                                // beta 54 B here
fakeSignature    = SHA1(ivStruct)[0..8]
clamp(b): b[0]&=0xF8; b[31]&=0x3F; b[31]|=0x40
```

SharedIV length = **64** → temp-hash buffer = 70 B in §4.6.

### 4.6 Per-packet EAX key/nonce (`GetKeyNonce`)

```
if (!CryptoInitComplete) return (DummyKey, DummyIv)   // pid-XOR below still applies
temp = new byte[ ivStruct.length==20 ? 26 : 70 ]
temp[0]    = fromServer ? 0x30 : 0x31                 // direction
temp[1]    = packetType (low 4 bits)
temp[2..6] = generationId as u32 BIG-ENDIAN
temp[6..]  = ivStruct                                 // 20 or 64 B
h = SHA256(temp)
key   = h[0..16] ; nonce = h[16..32]
key[0] ^= (packetId >> 8) & 0xFF                      // XOR into the KEY, not nonce!
key[1] ^=  packetId       & 0xFF
```

The `(direction,type,generation,ivStruct)` SHA256 is cached; only the 2-byte packet-id
XOR into `key[0..2]` varies per packet. **Common bug:** XORing packet id into the nonce.

### 4.7 EAX encrypt / MAC

- **AES-128 EAX**, `MacLen = 8` bytes.
- **Associated data = the plaintext Header** (3 or 5 B).
- Encrypt → `[ciphertext, 8-B tag]`; wire = `[ MAC(8) | Header | Ciphertext ]` (tag
  becomes the leading MAC). Decrypt = feed ciphertext + trailing 8-B tag + header AD;
  bad tag → drop.
- Unencrypted packets (UE) carry `fakeSignature` as MAC. Whether Voice is encrypted
  depends on server `CodecEncryptionMode` (Individual=0 / Disabled=1 / Enabled=2).
  Commands/Acks are always EAX-encrypted.
- Node has no native EAX — compose it (AES-CTR + OMAC/CMAC) or vendor a vetted impl,
  and test against TSLib vectors.

## 5. Command layer

Format: `commandname key1=value1 key2=value2 key3` (space-separated pairs, valueless
keys allowed). Bulk records separated by `|`. Server events are `notify…` lines.

**Escaping (TsString.cs — backslash first when encoding, last when decoding):**

| Raw | Esc | Raw | Esc | Raw | Esc |
|---|---|---|---|---|---|
| `\` | `\\` | `\n` | `\n` | `\t` | `\t` |
| `/` | `\/` | `\r` | `\r` | `\v` | `\v` |
| space | `\s` | `\|` | `\p` | `\f` | `\f` |

**Key bot commands:** `clientinit` (fields incl. `client_nickname`, `client_version`
+`client_version_sign`, `client_platform`, `client_default_channel`,
`client_default_channel_password`, `client_server_password`, `client_key_offset`,
`hwid`; passwords = `base64(SHA1(pw))`) → `initserver` (your `clid`) →
`channelsubscribeall`/`channelsubscribe cid=` → `notifyclientinitfinished`.
Events: `notifycliententerview` (clid,cid,client_nickname,…), `notifyclientleftview`,
`notifyclientmoved`, `notifytextmessage` (targetmode,msg,invoker…), `notifychannellist`.
Actions: `clientmove clid= cid= [cpw=]`, `clientupdate` (e.g. `client_input_muted`),
`sendtextmessage targetmode= target= msg=`.
Every Command sent is reliable — hold until its Ack, retransmit on timeout; every
Command received must be Ack'd with its packet id.

## 6. Voice

### 6.1 Payload (inside a Voice/VoiceWhisper data field)

**C2S:** `voiceCounter u16 BE (0–1)` + `codec byte (2)` + `codec frame (3…)`.
**S2C:** `voiceCounter u16 (0–1)` + `senderClientId u16 (2–3)` + `codec byte (4)` + `frame (5…)`.
Voice counter is its own u16, separate from packet ID. Whisper adds a target descriptor
after the codec byte (new-protocol group whisper: `GroupWhisperType(1) GroupWhisperTarget(1)
targetId(u64)`).

### 6.2 Codec IDs (`Codec : byte`)

| Codec | ID | | Codec | ID |
|---|---|---|---|---|
| SpeexNarrowband | 0 | | **OpusVoice** | **4** ← use this |
| SpeexWideband | 1 | | OpusMusic | 5 |
| SpeexUltraWideband | 2 | | | |
| CeltMono | 3 | | | |

Speex/CELT are dead — implement **Opus only**.

### 6.3 Opus parameters (EncoderPipe.cs)

| | OpusVoice (4) | OpusMusic (5) |
|---|---|---|
| Sample rate | 48000 Hz | 48000 Hz |
| Channels | 1 mono | 2 stereo |
| Application | VOIP | AUDIO |
| Default bitrate | 16384 bps | 32768 bps |

Frame 20 ms (960 samples @48k/ch), one Opus packet per UDP voice packet. Encode with
libopus (`@discordjs/opus` / `opusscript` / `node-opus`).

### 6.4 Talk start/stop

End-of-talk = a voice packet with an **empty codec frame** (0 Opus bytes after codec
byte); receiver flushes the jitter buffer and stops playback. Clients send ~1–5
terminating empty frames. Voice is fire-and-forget (no Ack).

## 7. Keepalive & reliability timing

- **Ping (0x4)**: empty, unencrypted, sent C2S ~every 1 s; server replies **Pong (0x5)**
  echoing the ping id (2-B data). You must Pong the server's pings too.
- **Timeout ~30 s** with no valid packet → connection dead.
- Reliable commands use **selective-repeat** (per-packet timers + backoff); give up after
  ~30 s. **Ack/AckLow** carry the acknowledged u16 id and are EAX-encrypted.

## 8. Prior art

- **HoneyBBQ/teamspeak-js** — the **one** pure-TS full-voice client (UDP+ACK, Init1 RSA,
  ECDH+EAX, Opus 4/5 send/recv, command/notify, TSDNS/SRV, flood limiter; zero native
  deps, Node ≥20). Closest existing prior art — study/fork, but verify crypto vs TSLib.
- `ts3-nodejs-library`, `teamspeak.js`, `node-ts` etc. = **ServerQuery only, no voice**.
- **TSLib** (C#) = ground truth; **ts3j** (Java) and **tsclientlib** (Rust) = cross-checks.

## 9. Module breakdown (build bottom-up)

```
1 transport/udp    dgram wrapper, MTU=500 guard. deps: node:dgram
2 packet/codec     header (de)serialize, Type+Flags, enums. deps: 1
3 crypto/          (a) identity P-256/DER/UID/hashcash/deobf
                   (b) handshake-secret ECDH + license/Curve25519 → ivStruct+fakeSig
                   (c) per-packet GetKeyNonce + AES-128-EAX. deps: 2 (+@noble/curves)
4 reliability/     per-(type,dir) id+generation counters, Ack, retransmit, Ping/Pong,
                   30s timeout, QuickLZ + fragmentation. deps: 2,3
5 init1/           packet 0..4 RSA puzzle (BigInt modpow), restart on step 127. deps: 1,2,3
6 command/         (de)serialize + escaping, bulk |, notify dispatcher, req/resp Ack. deps: 4
7 handshake/       orchestrate §4.2; flip CryptoInitComplete, set Client-ID. deps: 3,5,6
8 voice/           voice (de)serialize, Opus enc/dec, 20ms framing, empty-frame stop,
                   jitter buffer, whisper. deps: 2,4
9 client/          high-level TeamSpeak3Client wiring 1–8 onto ITeamSpeakClient. deps: all
```

**Implement/test order:** `1 → 2 → 3 → 4 → 6 → 5 → 7 → 8 → 9`. Validate crypto (3) and
escaping (6) with TSLib-captured vectors **before** a live connect; do init1 (5) live last.

## 10. Highest-risk unknowns

1. **New-protocol (≥3.1) crypto** — Curve25519 license chain, `clientek`, license parsing,
   `proof`. Many servers now require it. Port tsclientlib + TSLib block-by-block. *(medium)*
2. **`client_version` / `client_version_sign`** — RESOLVED. `Ts3ProtocolClient` ships a
   genuine TeamSpeak-signed Linux tuple (`3.5.5 [Build: 1594213121]`) from
   ReSpeak/tsdeclarations `Versions.csv`. The sign is Ed25519 over `version+platform`, so
   version/platform/sign stay a matched set; the Init1 §3 version field encodes that
   build's timestamp. Overridable via `Ts3ProtocolClientOptions`. *(done)*
3. **EAX in Node** — no native impl; compose AES-CTR+CMAC exactly or vendor one; test
   vectors. *(medium)*
4. **Generation-counter sync** — never on the wire; one missed wrap desyncs decryption. *(medium)*
5. **QuickLZ L1 streaming** — must be byte-compatible with `QuickerLz.cs`. *(medium)*
6. **RSA puzzle cost** — `x^(2^level) mod n`, server-chosen level; needs solid BigInt modpow. *(medium)*
7. **Voice encryption toggle & counter-reset** semantics — under-documented. *(medium)*
8. **`hwid` / anti-bot heuristics** — acceptable values not fully specified. *(low)*
