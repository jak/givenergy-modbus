# Protocol Internals

Technical details of the GivEnergy Modbus TCP protocol. This page is for contributors and anyone debugging inverter communication.

## Frame Format

GivEnergy uses a non-standard Modbus TCP framing. A standard Modbus TCP frame has a 7-byte MBAP header; GivEnergy wraps the inner Modbus PDU in a proprietary "transparent" frame:

```
Bytes 0-1:    Transaction ID (always 0x5959)
Bytes 2-3:    Protocol ID (always 0x0001)
Bytes 4-5:    Length (of everything after this field)
Byte 6:       Unit ID (always 0x01)
Byte 7:       Function ID (0x02 = transparent message)
Bytes 8-17:   Data adapter serial number (10 bytes, Latin-1)
Bytes 18-25:  Padding (see below)
Byte 26:      Slave address
Byte 27:      Inner function code
Bytes 28+:    Inner payload (register data)
Last 2 bytes: CRC-16/Modbus of bytes 26 onwards
```

### The Padding Field

The 8-byte padding field at bytes 18-25 is a **big-endian 64-bit integer with value 8**:

```
00 00 00 00 00 00 00 08
```

This is a common source of bugs — it looks like it could be `08 00 00 00 00 00 00 00` (little-endian), but the GivEnergy data adapter expects big-endian. Getting this wrong causes the adapter to silently drop the frame.

### No Trailing Null

Unlike some Modbus implementations, GivEnergy frames do **not** include a trailing null byte after the CRC. The frame ends immediately after the 2-byte CRC.

## Slave Addresses

| Address | Device |
|---------|--------|
| `0x11` | Inverter (single-phase Gen2/Gen3) |
| `0x31` | Inverter (AC/Gen1 — detected via HR(0)) |
| `0x32`–`0x37` | LV battery modules (up to 6) |
| `0x70`+ | HV BCU (Battery Control Unit) |
| `0x01`–`0x08` | CT meters |

## Inner Function Codes

| Code | Operation |
|------|-----------|
| `0x03` | Read holding registers |
| `0x04` | Read input registers |
| `0x06` | Write single holding register |
| `0x16` (22) | Read meter product registers |

## Register Layout

Registers are 16-bit unsigned values. The inverter supports two types:

- **Input registers (IR)** — read-only sensor data, power readings, energy totals
- **Holding registers (HR)** — read-write configuration, timeslots, enable flags

### Request Alignment

Each read request can fetch up to **60 registers** and the base address must be **60-aligned** (0, 60, 120, 180, ...). Requesting an unaligned base or more than 60 registers causes the inverter to return an error or garbage data.

### Key Register Blocks

**Input registers:**

| Base | Contents |
|------|----------|
| IR 0–59 | Power readings, PV data, battery state, grid measurements |
| IR 60–119 | Battery module data (cell voltages, temperatures) |
| IR 120–179 | (Reserved) |
| IR 180–239 | Energy totals (charge total, discharge total) |

**Holding registers:**

| Base | Contents |
|------|----------|
| HR 0–59 | Identity, system time, device type, mode flags, discharge slots |
| HR 60–119 | Charge slots, enable flags, charge target SOC, battery reserve |
| HR 120–179 | Firmware versions, additional config |
| HR 180–239 | Discharge energy total, additional settings |
| HR 240–359 | Gen3 extended registers (charge/discharge rates, pause mode) |
| HR 1080–1139 | Three-phase specific registers (rates, reserves, timeslots) |
| HR 4080–4139 | 32-bit battery energy totals (newer firmware) |

## Scaling Conventions

Raw register values need scaling before use:

| Function | Operation | Example |
|----------|-----------|---------|
| `toDeci` | ÷ 10 | IR(5) = 2320 → 232.0 V |
| `toCenti` | ÷ 100 | IR(50) = 4800 → 48.00 V |
| `toMilli` | ÷ 1000 | IR(80) = 3200 → 3.200 V |
| `toInt16` | Signed interpretation | IR(52) = 0xFFCE → -50 W |
| `toUint32` | Two registers → 32-bit | IR(11,12) → total energy |

## Heartbeat and Push Mode

The GivEnergy data adapter (the WiFi/Ethernet module attached to the inverter) has a heartbeat mechanism:

1. The adapter sends a heartbeat frame every ~3 minutes
2. The client must respond within 5 seconds or the adapter drops the connection
3. After the client responds to any request, the inverter enters **push mode** — it sends all register data in 60-register chunks without being asked

The library handles heartbeats automatically. Push mode data is accumulated by the poll manager alongside explicit register reads.

## Data Adapter Quirks

### Single Client

The data adapter does **not** reliably handle multiple concurrent TCP connections on port 8899. If two clients connect simultaneously, responses may be routed to the wrong client, causing timeouts and corrupted data in both.

### Response Routing

The data adapter uses the transaction ID to route responses back to the requesting client. Since the library uses a fixed TID (0x5959), there's no multiplexing — one request at a time.

### Empty Serial on Bad Connection

If the inverter returns an empty serial number in the first poll, the connection is likely unreliable. The library rejects this and throws during `connect()`.

## Device Type Detection

The inverter generation is detected from two holding registers:

1. **HR(0)** — device type code (e.g. `0x2001` = hybrid)
2. **HR(21)** — ARM firmware version (e.g. 300 = Gen3)

The `detectModel()` function combines these to determine the exact model. If HR(0) is 0 (not yet read), the library falls back to serial number prefix detection — but this is unreliable as many serial prefixes (like "FD" for Gen3) aren't in the prefix map.

| Prefix | Generation |
|--------|-----------|
| CE | Gen2 |
| EE | Gen3 |
| SA | Three-phase |
