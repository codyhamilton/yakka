# PR-VALIDATION-TOOLGROUNDED — TypeSafe maps-only report

- Driver/model: `TypeSafe` / `jev-1.13.0`
- Protocol SHA256: `f15e130fb807421a1f0ff0fe5feaf16b17897f586c7e1671da2f404a2b26ac06` (verified)
- Grid: 3 seats × 7 workers × 3 checkpoints = **63 cells**
- HTTP results: **63/63 successful**, errors: **0**
- Choice scrape: `response_class == response_label` for **63/63**
- Free-form wire: `noul` (63/63); no `text` wire used
- `building` gate violations: **0** (every building answer had Edit or Write evidence)
- No behavior ship; no `--call-jev`; no `:8080` use

## Choice counts

| choice | count |
|---|---:|
| `in_validation` | 11 |
| `building` | 25 |
| `inconclusive` | 27 |

## Pattern-note counts

| pattern_note | count |
|---|---:|
| `test_fix_loop` | 19 |
| `forward_edit` | 12 |
| `mixed_or_unclear` | 32 |

## Cell IDs

- `35e5af95db112d45` — seat-1 / 92a48e004519 / cp50
- `981709c6226b962f` — seat-1 / 92a48e004519 / cp60
- `0ce3cf39b289bb8d` — seat-1 / 92a48e004519 / cp75
- `30e8b649aa2554de` — seat-1 / ca977b9ca0dd / cp50
- `308a43da0e166f54` — seat-1 / ca977b9ca0dd / cp60
- `10c8bb713a469e49` — seat-1 / ca977b9ca0dd / cp75
- `e2ef17874cbc11dc` — seat-1 / 87a380bc64ff / cp50
- `e7097fa20a2b4338` — seat-1 / 87a380bc64ff / cp60
- `4c5af16d04e67760` — seat-1 / 87a380bc64ff / cp75
- `b92f04b166ea407c` — seat-1 / bb6165018de0 / cp50
- `3d020411b84937f0` — seat-1 / bb6165018de0 / cp60
- `33f1cecdedc62e59` — seat-1 / bb6165018de0 / cp75
- `d33db379b0b302ff` — seat-1 / 15f24c7ba18c / cp50
- `54c04c25ae73a010` — seat-1 / 15f24c7ba18c / cp60
- `0036f5ecd45fcab8` — seat-1 / 15f24c7ba18c / cp75
- `0e16b22356a28fe9` — seat-1 / 0677f597286e / cp50
- `1fa73fd9550408b4` — seat-1 / 0677f597286e / cp60
- `57cbebb9a8fba48d` — seat-1 / 0677f597286e / cp75
- `b9fc385cf5c52ae5` — seat-1 / 074c8cf22927 / cp50
- `66337e3ad6df0789` — seat-1 / 074c8cf22927 / cp60
- `825986fe394cb036` — seat-1 / 074c8cf22927 / cp75
- `06dc5e3e38646a45` — seat-2 / 92a48e004519 / cp50
- `3a8f7b872a71f0fb` — seat-2 / 92a48e004519 / cp60
- `677a1167c42c2930` — seat-2 / 92a48e004519 / cp75
- `601beb2c9976ad77` — seat-2 / ca977b9ca0dd / cp50
- `fe601352340eed64` — seat-2 / ca977b9ca0dd / cp60
- `6a7fddf40f4221ac` — seat-2 / ca977b9ca0dd / cp75
- `de6adcc9301d3dbe` — seat-2 / 87a380bc64ff / cp50
- `ae84552c67dda79d` — seat-2 / 87a380bc64ff / cp60
- `2e14a6d108668544` — seat-2 / 87a380bc64ff / cp75
- `dcaa0672569a78be` — seat-2 / bb6165018de0 / cp50
- `63d30f723fe961db` — seat-2 / bb6165018de0 / cp60
- `fff345620f4aff81` — seat-2 / bb6165018de0 / cp75
- `7c95d835e8cec4c4` — seat-2 / 15f24c7ba18c / cp50
- `a08ff73ebafc4a64` — seat-2 / 15f24c7ba18c / cp60
- `a9490dde261e6b8f` — seat-2 / 15f24c7ba18c / cp75
- `c1aa2b86b40589fa` — seat-2 / 0677f597286e / cp50
- `4192c24a9348525e` — seat-2 / 0677f597286e / cp60
- `54e46ecac369b66b` — seat-2 / 0677f597286e / cp75
- `b51d96f0df027d2c` — seat-2 / 074c8cf22927 / cp50
- `965cb090b6c2499a` — seat-2 / 074c8cf22927 / cp60
- `9fde1d355fdfab03` — seat-2 / 074c8cf22927 / cp75
- `60d493bcf4ad786c` — seat-3 / 92a48e004519 / cp50
- `4a2758b99d8e7429` — seat-3 / 92a48e004519 / cp60
- `fd774b7d31d8fd6d` — seat-3 / 92a48e004519 / cp75
- `38a33d2dd42488f7` — seat-3 / ca977b9ca0dd / cp50
- `38397d20099c37d4` — seat-3 / ca977b9ca0dd / cp60
- `c372a810bfaf43ab` — seat-3 / ca977b9ca0dd / cp75
- `9edac244027f6109` — seat-3 / 87a380bc64ff / cp50
- `6f8dff07eefa6765` — seat-3 / 87a380bc64ff / cp60
- `6160260517b2d4d3` — seat-3 / 87a380bc64ff / cp75
- `2a1e9c25fc2a59af` — seat-3 / bb6165018de0 / cp50
- `176190837709451e` — seat-3 / bb6165018de0 / cp60
- `dd127f7003830ea2` — seat-3 / bb6165018de0 / cp75
- `f32700d299cd9e1c` — seat-3 / 15f24c7ba18c / cp50
- `4ff210a2cec1c0df` — seat-3 / 15f24c7ba18c / cp60
- `430ca4fa110c0e8d` — seat-3 / 15f24c7ba18c / cp75
- `1a0c4cca1f716787` — seat-3 / 0677f597286e / cp50
- `5f7c963b589813c0` — seat-3 / 0677f597286e / cp60
- `f3474f5d2090e860` — seat-3 / 0677f597286e / cp75
- `ff80a8725b1fd934` — seat-3 / 074c8cf22927 / cp50
- `6d0fb456a1475544` — seat-3 / 074c8cf22927 / cp60
- `3b0f932e358dde2e` — seat-3 / 074c8cf22927 / cp75
