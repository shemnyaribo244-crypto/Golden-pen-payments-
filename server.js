
const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Temporary payment records for sandbox testing.
// These are lost if the server restarts.
const payments = new Map();

const TICKETS = {
  500: "Regular",
  1500: "VIP",
  2500: "VVIP"
};

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
body {
  font-family: Arial, sans-serif;
  background: #111;
  color: white;
  padding: 20px;
  text-align: center;
}
.box {
  max-width: 420px;
  margin: 30px auto;
  padding: 22px;
  background: #222;
  border-radius: 14px;
}
select, input, button {
  width: 100%;
  padding: 14px;
  margin: 10px 0;
  box-sizing: border-box;
  border-radius: 7px;
  font-size: 16px;
}
button {
  background: #d6a32a;
  border: 0;
  font-weight: bold;
}
#message { white-space: pre-wrap; }
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

<input id="phone" type="tel"
placeholder="M-Pesa number e.g. 07XXXXXXXX">

<button id="payButton" onclick="pay()">
PAY WITH M-PESA
</button>

<p id="message"></p>
</div>

<script>
async function pay() {
  const message = document.getElementById("message");
  const button = document.getElementById("payButton");
  let phone = document.getElementById("phone").value.trim();
  const amount = Number(document.getElementById("amount").value);

  if (phone.startsWith("0")) {
    phone = "254" + phone.substring(1);
  } else if (phone.startsWith("+254")) {
    phone = phone.substring(1);
  }

  if (!/^254[17]\\d{8}$/.test(phone)) {
    message.textContent = "Enter a valid Kenyan phone number.";
    return;
  }

  button.disabled = true;
  message.textContent = "Sending M-Pesa payment request...";

  try {
    const response = await fetch("/api/stkpush", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, amount })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Payment request failed.");
    }

    const id = result.CheckoutRequestID;

    if (!id) {
      throw new Error("No payment request ID received.");
    }

    message.textContent =
      "Request sent. Complete the payment prompt if received. Waiting for confirmation...";

    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const check = await fetch(
        "/api/payment-status/" + encodeURIComponent(id)
      );

      const status = await check.json();

      if (status.status === "paid") {
        message.textContent =
          "PAYMENT CONFIRMED!\\n" +
          "Ticket: " + status.ticketCode + "\\n" +
          "Type: " + status.ticketType + "\\n" +
          "M-Pesa receipt: " + status.receipt;
        return;
      }

      if (status.status === "failed") {
        message.textContent =
          "Payment was not completed: " + status.message;
        return;
      }
    }

    message.textContent =
      "Confirmation is taking longer than expected. Please check again later.";

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

    if (
      !DARAJA_CONSUMER_KEY ||
      !DARAJA_CONSUMER_SECRET ||
      !DARAJA_SHORTCODE ||
      !DARAJA_PASSKEY ||
      !CALLBACK_URL
    ) {
      return res.status(500).json({
        error: "M-Pesa environment settings are incomplete."
      });
    }

    if (!CALLBACK_URL.startsWith("https://")) {
      return res.status(500).json({
        error: "Callback URL must use HTTPS."
      });
    }

    const phone = String(req.body.phone || "");
    const amount = Number(req.body.amount);

    if (!/^254[17]\d{8}$/.test(phone)) {
      return res.status(400).json({
        error: "Invalid Kenyan phone number."
      });
    }

    if (!Object.prototype.hasOwnProperty.call(TICKETS, amount)) {
      return res.status(400).json({
        error: "Invalid ticket amount."
      });
    }

    const credentials = Buffer.from(
      DARAJA_CONSUMER_KEY + ":" + DARAJA_CONSUMER_SECRET
    ).toString("base64");

    const authResponse = await fetch(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: "Basic " + credentials
        }
      }
    );

    const authText = await authResponse.text();
console.log("Daraja Auth:", authResponse.status, authText);

let auth;
try {
  auth = JSON.parse(authText);
} catch {
  throw new Error("Daraja authentication returned an empty or invalid response.");
}

    if (!authResponse.ok || !auth.access_token) {
      return res.status(502).json({
        error: "Daraja authentication failed."
      });
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());

    const date = {};
    for (const part of parts) {
      date[part.type] = part.value;
    }

    const timestamp =
      date.year + date.month + date.day +
      date.hour + date.minute + date.second;

    const password = Buffer.from(
      DARAJA_SHORTCODE + DARAJA_PASSKEY + timestamp
    ).toString("base64");

    const stkResponse = await fetch(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + auth.access_token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          BusinessShortCode: DARAJA_SHORTCODE,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerPayBillOnline",
          Amount: amount,
          PartyA: phone,
          PartyB: DARAJA_SHORTCODE,
          PhoneNumber: phone,
          CallBackURL: CALLBACK_URL,
          AccountReference: "GOLDENPEN",
          TransactionDesc: "Golden Pen Show Ticket"
        })
      }
    );

    const stkText = await stkResponse.text();
console.log("Daraja STK:", stkResponse.status, stkText);

let result;
try {
  result = JSON.parse(stkText);
} catch {
  throw new Error("Daraja STK returned an empty or invalid response.");
      }

    if (!stkResponse.ok || result.ResponseCode !== "0") {
      return res.status(502).json({
        error: result.errorMessage ||
          result.ResponseDescription ||
          "Safaricom rejected the request."
      });
    }

    payments.set(result.CheckoutRequestID, {
      status: "pending",
      amount,
      phone,
      ticketType: TICKETS[amount]
    });

    res.json(result);

  } catch (error) {
    console.error("STK error:", error.message);
    res.status(500).json({
      error: "Could not send M-Pesa request."
    });
  }
});

// Receive Safaricom payment callback
app.post("/api/callback", (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      return res.status(400).json({
        ResultCode: 1,
        ResultDesc: "Invalid callback."
      });
    }

    const id = callback.CheckoutRequestID;
    const payment = payments.get(id);

    if (payment) {
      if (Number(callback.ResultCode) === 0) {
        const items =
          callback.CallbackMetadata?.Item || [];

        const getItem = name =>
          items.find(item => item.Name === name)?.Value;

        if (payment.status !== "paid") {
          payment.status = "paid";
          payment.receipt = getItem("MpesaReceiptNumber") || "";
          payment.ticketCode =
            "GPS-" + crypto.randomUUID().slice(0, 8).toUpperCase();
        }
      } else {
        payment.status = "failed";
        payment.message =
          callback.ResultDesc || "Payment was not completed.";
      }
    }

    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });

  } catch (error) {
    console.error("Callback error:", error.message);
    res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Callback processing error."
    });
  }
});

// Check payment result
app.get("/api/payment-status/:id", (req, res) => {
  const payment = payments.get(req.params.id);

  if (!payment) {
    return res.status(404).json({
      status: "unknown"
    });
  }

  res.json({
    status: payment.status,
    ticketCode: payment.ticketCode || null,
    ticketType: payment.ticketType,
    receipt: payment.receipt || null,
    message: payment.message || null
  });
});

app.listen(PORT, () => {
  console.log("Golden Pen server running on port " + PORT);
});
        
