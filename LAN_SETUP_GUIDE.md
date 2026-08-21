# 🌐 LAN Network Setup Guide
## Security Firm Management Software — Multi-Device Access

> **Purpose:** Allow staff phones, tablets, and other office computers to access the software from the same Wi-Fi network.

---

## 📋 Requirements

| What | Details |
|------|---------|
| **Main Server PC** | The laptop/PC where MySQL is installed (`HET`) |
| **Server Wi-Fi Name** | `Het_5G` (or your office Wi-Fi) |
| **Server IP Address** | `192.168.29.19` |
| **App Port** | `3000` |
| **Access URL** | `http://192.168.29.19:3000` |

> **Note:** If your IP ever changes, run `ipconfig` in Command Prompt and look for the new IPv4 Address under your Wi-Fi adapter.

---

## 🖥️ STEP 1 — Start the Server (Main PC Only)

Do this **once** every time you turn on the main PC:

1. Open a **Command Prompt** or **Terminal** in the project folder:
   ```
   C:\Users\ratan\OneDrive\Desktop\Secuirtyagencysoftware
   ```
2. Run:
   ```
   node src/index.js
   ```
3. You should see:
   ```
   🚀 Security Firm Server running on port 3000
   🖥️  Local:   http://localhost:3000
   🌐 Network: http://192.168.29.19:3000
   ```
4. **Keep this window open** while using the software. Do NOT close it.

---

## 🔥 STEP 2 — Open Windows Firewall (One-Time Setup)

This allows other devices to connect. **Only needs to be done once.**

### Option A — Using the Helper Script (Easiest)
1. Open the `scripts` folder in File Explorer.
2. **Right-click** on `allow_firewall.bat` → **"Run as administrator"**.
3. Click **Yes** on the Windows prompt.
4. You will see: `[SUCCESS] Port 3000 is now open in Windows Firewall!`

### Option B — Using Command Prompt
1. Press `Win` key → type `cmd` → **right-click** → **"Run as administrator"**.
2. Paste this command and press **Enter**:
   ```
   netsh advfirewall firewall add rule name="Security Firm App Port 3000" dir=in action=allow protocol=TCP localport=3000
   ```
3. You will see: `Ok.`

---

## 📶 STEP 3 — Set Wi-Fi as "Private" (One-Time Setup)

Windows blocks LAN connections when Wi-Fi is set to "Public". Change it once:

1. Press `Win + I` → **Network & internet** → **Wi-Fi**.
2. Click your connected network (`Het_5G`).
3. Under **Network profile type**, select **Private network**.

---

## 📱 STEP 4 — Connect Other Devices (Staff Phones / PCs)

For **every new device** (phone, tablet, another PC):

1. Connect the device to the **same Wi-Fi** (`Het_5G`).
2. Open **Google Chrome** or any browser.
3. Type in the address bar (include `http://`):
   ```
   http://192.168.29.19:3000
   ```
4. Press **Go / Enter**.
5. The login screen will appear.

### 💾 Save as Bookmark (Recommended)
- **Chrome Desktop:** Press `Ctrl + D` or click the ⭐ star icon.
- **Chrome Mobile:** Tap the three dots `⋮` → **Add to Home screen**.

---

## 🔑 Default Login Credentials

| Field | Value |
|-------|-------|
| **Email** | `admin@example.com` |
| **Password** | `admin123` |
| **Role** | Admin (full access) |

> ⚠️ **Change the default password** after first login from Settings → Profile.

---

## ❓ Troubleshooting

### "This site can't be reached" / ERR_CONNECTION_TIMED_OUT
- ✅ Make sure the server is running (Step 1).
- ✅ Make sure the Firewall rule is added (Step 2).
- ✅ Make sure Wi-Fi is set to **Private** (Step 3).
- ✅ Both devices must be on the **same Wi-Fi network**.

### "Something went wrong" error on phone
- Hard refresh: close the browser tab completely and reopen the URL.
- Clear browser cache on the phone.

### Page loads but stuck on "Verifying license..."
- The server may have just started — wait 5 seconds and refresh.
- If it persists, restart the server (close and redo Step 1).

### IP address changed after router restart
- Run `ipconfig` on the main PC and find the new **IPv4 Address**.
- Use the new IP: `http://<NEW_IP>:3000`
- **Permanent fix:** Set a Static IP (see Section below).

---

## 🔒 Setting a Permanent / Static IP (Optional but Recommended)

Prevents your IP from ever changing:

1. Press `Win + I` → **Network & internet** → **Wi-Fi**.
2. Click your Wi-Fi network → **Edit** (next to IP assignment).
3. Switch from **Automatic (DHCP)** to **Manual** → turn on **IPv4**.
4. Enter:
   - **IP address:** `192.168.29.19`
   - **Subnet mask:** `255.255.255.0`
   - **Gateway:** `192.168.29.1`
   - **Preferred DNS:** `8.8.8.8`
   - **Alternate DNS:** `1.1.1.1`
5. Click **Save**.

---

## 💰 Cost & Security

| Item | Details |
|------|---------|
| **Cost** | ₹0 — 100% Free (built-in Windows features) |
| **Internet Required** | ❌ No — works on local network only |
| **Visible to Outside Internet** | ❌ No — private LAN IP only |
| **Login Protection** | ✅ Password + Role-Based Permissions |
| **Data on Network** | ✅ Stays within your office Wi-Fi only |

---

## 📁 Key File Locations

| File | Location |
|------|----------|
| Server entry point | `src/index.js` |
| Firewall helper script | `scripts/allow_firewall.bat` |
| Database seed script | `seed.js` |
| This guide | `LAN_SETUP_GUIDE.md` |

---

*Last updated: August 2026*
*Server: HET | IP: 192.168.29.19 | Port: 3000*
