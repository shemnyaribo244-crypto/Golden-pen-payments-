const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const TICKETS = {
  500: "Regular",
  1500: "VIP",
  2500: "VVIP"
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function adminAuth(req, res, next) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const header = req.headers.authorization || "";

  if (!username || !password) {
    return res.status(503).send("Admin login is not configured.");
  }

  if (header.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(
        header.slice(6), "base64"
      ).toString("utf8");

      const separator = decoded.indexOf(":");
      const suppliedUser = decoded.slice(0, separator);
      const suppliedPassword = decoded.slice(separator + 1);

      const userOK =
        suppliedUser.length === username.length &&
        crypto.timingSafeEqual(
          Buffer.from(suppliedUser),
          Buffer.from(username)
        );

      const passOK =
        suppliedPassword.length === password.length &&
        crypto.timingSafeEqual(
          Buffer.from(suppliedPassword),
          Buffer.from(password)
        );

      if (separator >= 0 && userOK && passOK) {
        return next();
      }
    } catch (error) {
      // Reject invalid credentials.
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Golden Pen Admin"');
  return res.status(401).send("Admin login required.");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

app.get("/", (req, res) => {
  res.send("Golden Pen Show payment server is running.");
});

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

// Ticket checkout page
app.get("/checkout", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golden Pen Show Tickets</title>
<style>
body {font-family:Arial;background:#111;color:white;padding:20px;text-align:center}
.box {max-width:420px;margin:30px auto;padding:22px;background:#222;border-radius:14px}
select,input,button {width:100%;padding:14px;margin:10px 0;box-sizing:border-box;border-radius:7px;font-size:16px}
button {background:#d6a32a;border:0;font-weight:bold}
#message {white-space:pre-wrap}
</style>
</head>
<body>
<div class="box">
<h1>GOLDEN PEN SHOW</h1>
<p>12 December 2026</p>
<p>Magnum Club, Kisii</p>
<h3>Select Your Ticket</h3>
<select id="amount">
<option value="500">Regular - KSh 500</option>
<option value="1500">VIP - KSh 1,500</option>
<option value="2500">VVIP - KSh 2,500</option>
</select>
<input id="phone" type="tel" placeholder="M-Pesa number e.g. 07XXXXXXXX">
<button id="payButton" onclick="pay()">PAY WITH M-PESA</button>
<p id="message"></p>
</div>
<script>
async function pay() {
  const message = document.getElementById("message");
  const button = document.getElementById("payButton");
  let phone = document.getElementById("phone").value.trim();
  const amount = Number(document.getElementById("amount").value);

  if (phone.startsWith("0")) phone = "254" + phone.substring(1);
  else if (phone.startsWith("+254")) phone = phone.substring(1);

  if (!/^254[17]\\d{8}$/.test(phone)) {
    message.textContent = "Enter a valid Kenyan phone number.";
    return;
  }

  button.disabled = true;
  message.textContent = "Sending M-Pesa payment request...";

  try {
    const response = await fetch("/api/stkpush", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({phone, amount})
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Payment request failed.");

    const id = result.CheckoutRequestID;
    if (!id) throw new Error("No payment request ID received.");

    message.textContent = "Request sent. Complete the M-Pesa prompt. Waiting for confirmation...";

    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const check = await fetch("/api/payment-status/" + encodeURIComponent(id));
      const status = await check.json();

      if (status.status === "paid") {
        message.textContent =
          "PAYMENT CONFIRMED!\\nTicket: " + status.ticketCode +
          "\\nType: " + status.ticketType +
          "\\nM-Pesa receipt: " + status.receipt;
        return;
      }

      if (status.status === "failed") {
        message.textContent = "Payment was not completed: " + status.message;
        return;
      }
    }

    message.textContent = "Confirmation is taking longer than expected. Please check again later.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
</script>
</body>
</html>
  `);
});

// Start M-Pesa STK Push
app.post("/api/stkpush", async (req, res) => {
  try {
    const {
      DARAJA_CONSUMER_KEY,
      DARAJA_CONSUMER_SECRET,
      DARAJA_SHORTCODE,
      DARAJA_PASSKEY,
      CALLBACK_URL
    } = process.env;

    if (!DARAJA_CONSUMER_KEY || !DARAJA_CONSUMER_SECRET ||
        !DARAJA_SHORTCODE || !DARAJA_PASSKEY || !CALLBACK_URL) {
      return res.status(500).json({error:"M-Pesa settings are incomplete."});
    }

    if (!CALLBACK_URL.startsWith("https://")) {
      return res.status(500).json({error:"Callback URL must use HTTPS."});
    }

    const phone = String(req.body.phone || "");
    const amount = Number(req.body.amount);

    if (!/^254[17]\d{8}$/.test(phone)) {
      return res.status(400).json({error:"Invalid Kenyan phone number."});
    }

    if (!Object.prototype.hasOwnProperty.call(TICKETS, amount)) {
      return res.status(400).json({error:"Invalid ticket amount."});
    }

    const credentials = Buffer.from(
      DARAJA_CONSUMER_KEY + ":" + DARAJA_CONSUMER_SECRET
    ).toString("base64");

    const authResponse = await fetch(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {headers:{Authorization:"Basic " + credentials}}
    );

    const authText = await authResponse.text();
    let auth;

    try {
      auth = JSON.parse(authText);
    } catch {
      throw new Error("Invalid Daraja authentication response.");
    }

    if (!authResponse.ok || !auth.access_token) {
      throw new Error("Daraja authentication failed.");
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone:"Africa/Nairobi",
      year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",second:"2-digit",
      hourCycle:"h23"
    }).formatToParts(new Date());

    const date = {};
    for (const part of parts) date[part.type] = part.value;

    const timestamp =
      date.year + date.month + date.day +
      date.hour + date.minute + date.second;

    const password = Buffer.from(
      DARAJA_SHORTCODE + DARAJA_PASSKEY + timestamp
    ).toString("base64");

    const stkResponse = await fetch(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        method:"POST",
        headers:{
          Authorization:"Bearer " + auth.access_token,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          BusinessShortCode:DARAJA_SHORTCODE,
          Password:password,
          Timestamp:timestamp,
          TransactionType:"CustomerPayBillOnline",
          Amount:amount,
          PartyA:phone,
          PartyB:DARAJA_SHORTCODE,
          PhoneNumber:phone,
          CallBackURL:CALLBACK_URL,
          AccountReference:"GOLDENPEN",
          TransactionDesc:"Golden Pen Show Ticket"
        })
      }
    );

    const stkText = await stkResponse.text();
    let result;

    try {
      result = JSON.parse(stkText);
    } catch {
      throw new Error("Invalid Daraja STK response.");
    }

    if (!stkResponse.ok || result.ResponseCode !== "0" ||
        !result.CheckoutRequestID) {
      return res.status(502).json({
        error:result.errorMessage || result.ResponseDescription ||
          "Safaricom rejected the request."
      });
    }

    const {error: dbError} = await supabase
      .from("ticket_sales")
      .insert({
        checkout_request_id:result.CheckoutRequestID,
        customer_phone:phone,
        ticket_type:TICKETS[amount],
        amount,
        payment_status:"pending"
      });

    if (dbError) {
      console.error("Database insert error:", dbError.message);
      return res.status(500).json({
        error:"Payment request was sent, but its record could not be saved. Contact the ticket seller before trying again."
      });
    }

    res.json(result);

  } catch (error) {
    console.error("STK error:", error.message);
    res.status(500).json({error:"Could not send M-Pesa request."});
  }
});

// Receive Safaricom payment callback
app.post("/api/callback", async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback || !callback.CheckoutRequestID) {
      return res.status(400).json({
        ResultCode:1,ResultDesc:"Invalid callback."
      });
    }

    const id = callback.CheckoutRequestID;

    const {data:payment,error:findError} = await supabase
      .from("ticket_sales")
      .select("*")
      .eq("checkout_request_id",id)
      .maybeSingle();

    if (findError || !payment) {
      console.error("Payment record not found:", id, findError?.message);
      return res.status(500).json({
        ResultCode:1,ResultDesc:"Payment record not found."
      });
    }

    // Do not issue another ticket for duplicate callbacks.
    if (payment.payment_status === "paid") {
      return res.json({ResultCode:0,ResultDesc:"Already processed"});
    }

    if (Number(callback.ResultCode) === 0) {
      const items = callback.CallbackMetadata?.Item || [];
      const getItem = name => items.find(item => item.Name === name)?.Value;

      const receipt = getItem("MpesaReceiptNumber");
      const paidAmount = Number(getItem("Amount"));
      const paidPhone = String(getItem("PhoneNumber") || "");

      if (!receipt || paidAmount !== Number(payment.amount) ||
          (paidPhone && paidPhone !== payment.customer_phone)) {
        console.error("Payment callback details did not match:", id);
        return res.status(400).json({
          ResultCode:1,ResultDesc:"Payment details did not match."
        });
      }

      const ticketCode =
        "GPS-" + crypto.randomUUID().slice(0,8).toUpperCase();

      const {error:updateError} = await supabase
        .from("ticket_sales")
        .update({
          payment_status:"paid",
          mpesa_receipt:String(receipt),
          ticket_code:ticketCode
        })
        .eq("checkout_request_id",id)
        .eq("payment_status","pending");

      if (updateError) throw updateError;

    } else {
      const {error:updateError} = await supabase
        .from("ticket_sales")
        .update({
          payment_status:"failed"
        })
        .eq("checkout_request_id",id)
        .eq("payment_status","pending");

      if (updateError) throw updateError;
    }

    res.json({ResultCode:0,ResultDesc:"Accepted"});

  } catch (error) {
    console.error("Callback error:",error.message);
    res.status(500).json({
      ResultCode:1,ResultDesc:"Callback processing error."
    });
  }
});

// Check payment result
app.get("/api/payment-status/:id", async (req, res) => {
  const {data:payment,error} = await supabase
    .from("ticket_sales")
    .select("*")
    .eq("checkout_request_id",req.params.id)
    .maybeSingle();

  if (error) {
    return res.status(500).json({status:"error"});
  }

  if (!payment) {
    return res.status(404).json({status:"unknown"});
  }

  res.json({
    status:payment.payment_status,
    ticketCode:payment.ticket_code,
    ticketType:payment.ticket_type,
    receipt:payment.mpesa_receipt,
    message:payment.payment_status === "failed" ?
      "Payment was not completed." : null
  });
});

// Password-protected sales dashboard
app.get("/admin", adminAuth, async (req, res) => {
  res.set("Cache-Control","no-store");

  const {data:sales,error} = await supabase
    .from("ticket_sales")
    .select("*")
    .order("created_at",{ascending:false})
    .limit(500);

  if (error) {
    console.error("Dashboard error:",error.message);
    return res.status(500).send("Could not load ticket sales.");
  }

  const paid = sales.filter(s => s.payment_status === "paid");
  const total = paid.reduce((sum,s) => sum + Number(s.amount),0);
  const pending = sales.filter(s => s.payment_status === "pending").length;

  const rows = sales.map(s => `
    <tr>
      <td>${escapeHTML(s.customer_phone)}</td>
      <td>${escapeHTML(s.ticket_type)}</td>
      <td>KSh ${Number(s.amount).toLocaleString("en-KE")}</td>
      <td>${escapeHTML(s.payment_status)}</td>
      <td>${escapeHTML(s.mpesa_receipt || "-")}</td>
      <td>${escapeHTML(s.ticket_code || "-")}</td>
      <td>${escapeHTML(s.created_at || "-")}</td>
    </tr>
  `).join("");

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Golden Pen Admin</title>
<style>
body{font-family:Arial;background:#111;color:white;padding:15px}
h1{color:#d6a32a}
.cards{display:flex;flex-wrap:wrap;gap:12px}
.card{background:#222;padding:18px;border-radius:10px;flex:1;min-width:130px}
table{border-collapse:collapse;width:100%;min-width:850px}
th,td{padding:10px;border-bottom:1px solid #444;text-align:left}
th{color:#d6a32a}
.tablewrap{overflow-x:auto;margin-top:20px}
small{color:#bbb}
</style>
</head>
<body>
<h1>GOLDEN PEN SHOW</h1>
<h2>Private Sales Dashboard</h2>
<div class="cards">
<div class="card"><h3>Total collected</h3><h2>KSh ${total.toLocaleString("en-KE")}</h2></div>
<div class="card"><h3>Paid tickets</h3><h2>${paid.length}</h2></div>
<div class="card"><h3>Pending payments</h3><h2>${pending}</h2></div>
<div class="card"><h3>Records shown</h3><h2>${sales.length}</h2></div>
</div>
<p><small>Showing up to the latest 500 payment records. Totals above cover these records only.</small></p>
<div class="tablewrap">
<table>
<thead><tr>
<th>Phone</th><th>Ticket</th><th>Amount</th>
<th>Status</th><th>M-Pesa receipt</th><th>Ticket code</th><th>Date</th>
</tr></thead>
<tbody>${rows || "<tr><td colspan='7'>No sales recorded yet.</td></tr>"}</tbody>
</table>
</div>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log("Golden Pen server running on port " + PORT);
});
    
