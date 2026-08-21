# 🖥️ Security Firm Management Software
## Installation & LAN Setup Guide (EXE Version)

---

## 📦 STEP 1 — Install the Software (Main Office PC Only)

> Do this **only on the main PC** where MySQL is installed.

1. Find the installer file:
   ```
   Security Firm Management Setup 1.0.2.exe
   ```
2. **Double-click** it to run the installer.
3. Click **Yes** on the Windows security prompt.
4. The software will install automatically.
5. A shortcut icon will appear on your **Desktop**.

---

## ⚙️ STEP 2 — MySQL Must Be Installed (Main PC Only)

The software needs MySQL to store data. MySQL must be installed on the **main PC only**.

- Download MySQL Community Server (free):
  👉 https://dev.mysql.com/downloads/mysql/

- During MySQL setup:
  - **Port:** `3306` (default — do not change)
  - **Root Password:** set a password and remember it
  - Note it down, you will need it when the software first starts

> Staff computers (other PCs, phones) do **NOT** need MySQL.

---

## 🔥 STEP 3 — Open Windows Firewall (One-Time, Main PC Only)

This allows staff phones and other PCs to connect. **Only needs to be done once.**

1. Press the `Win` key → type `cmd`.
2. **Right-click** on **Command Prompt** → **"Run as administrator"**.
3. Click **Yes** on the Windows prompt.
4. Paste this command and press **Enter**:
   ```
   netsh advfirewall firewall add rule name="Security Firm App Port 3000" dir=in action=allow protocol=TCP localport=3000
   ```
5. You will see: `Ok.`

---

## 📶 STEP 4 — Set Wi-Fi as "Private" (One-Time, Main PC Only)

1. Press `Win + I` → **Network & internet** → **Wi-Fi**.
2. Click your connected Wi-Fi network name.
3. Under **Network profile type**, select **Private network**.

---

## 🚀 STEP 5 — Open the Software (Main PC)

1. Double-click the **Security Firm Management** icon on your Desktop.
2. The software will open and start the server automatically.
3. Log in with your admin credentials.

> ⚠️ **Keep the software open on the main PC** while staff members are using it on other devices.

---

## 🔍 STEP 6 — Find Your PC's IP Address

Other staff devices need your PC's IP address to connect.

1. Press `Win + R` → type `cmd` → press **Enter**.
2. Type this command and press **Enter**:
   ```
   ipconfig
   ```
3. Look for **IPv4 Address** under your Wi-Fi adapter:
   ```
   IPv4 Address. . . . . . . : 192.168.X.X
   ```
4. That number (e.g. `192.168.29.19`) is your PC's address.
5. The full access link for staff is:
   ```
   http://192.168.29.19:3000
   ```
   *(replace `192.168.29.19` with your actual IP)*

---

## 📱 STEP 7 — Connect Staff Devices (Phones / Other PCs)

For **each staff phone, tablet, or PC**:

1. Connect the device to the **same office Wi-Fi** as the main PC.
2. Open **Google Chrome** (or any browser).
3. In the address bar, type *(include `http://`)*:
   ```
   http://192.168.29.19:3000
   ```
4. Press **Go / Enter**.
5. The login screen will appear.

### 💾 Save as Shortcut on Phone (Recommended)
- Open Chrome on the phone → tap the three dots `⋮`
- Tap **"Add to Home screen"**
- Name it **"Security Firm"** → tap **Add**
- The icon will appear on the phone's home screen like an app!

---

## 🔑 Default Login Credentials

| Field | Value |
|-------|-------|
| **Email** | `admin@example.com` |
| **Password** | `admin123` |

> ⚠️ **Change the default password** after first login for security.

---

## 👥 Adding Staff Accounts

1. Log in as **admin**.
2. Go to **Settings** → **User Management**.
3. Click **Add User**.
4. Set their name, email, password, and role (Admin / Staff).
5. Share their email and password with the staff member.

---

## 📋 Summary Table

| Device | Needs Installation | What to Do |
|--------|-------------------|------------|
| **Main Office PC** | ✅ MySQL + EXE installer | Run the .exe app daily |
| **Staff PC / Laptop** | ❌ Nothing to install | Open Chrome → type the IP link |
| **Staff Mobile Phone** | ❌ Nothing to install | Open Chrome → type the IP link |
| **Staff Tablet** | ❌ Nothing to install | Open Chrome → type the IP link |

---

## ❓ Troubleshooting

### "This site can't be reached" on phone
- ✅ Is the main PC's software open and running?
- ✅ Are both devices on the same Wi-Fi?
- ✅ Was the Firewall rule added? (Step 3)
- ✅ Is the IP address correct? (Run `ipconfig` again)

### "Something went wrong" on first load
- Close the browser tab completely and reopen the URL.
- Wait 10 seconds and try again (server may still be starting).

### Software won't start / database error
- Make sure **MySQL** is installed and running on the main PC.
- Check that the MySQL password in the software settings matches your MySQL root password.

### IP address changed after router restart
- Run `ipconfig` again to get the new IP.
- Share the new link with staff: `http://<NEW_IP>:3000`
- **Permanent fix:** Set a Static IP in Windows network settings.

---

## 💰 Cost Summary

| Item | Cost |
|------|------|
| **Software (.exe)** | ₹0 |
| **MySQL Community Server** | ₹0 (Free) |
| **LAN / Wi-Fi access** | ₹0 (uses existing office Wi-Fi) |
| **Staff device setup** | ₹0 (just a browser bookmark) |

---

## 🔒 Is It Safe?

✅ **Yes.** The access link (`192.168.X.X`) only works **inside your office Wi-Fi**.
People outside your office or on the internet **cannot see or access it at all.**

---

*Security Firm Management Software v1.0.2*
*For technical support, contact your software provider.*
