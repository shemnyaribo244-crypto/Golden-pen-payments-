
const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Golden Pen Show payment server is running.");
});

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

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
        error: "Payment settings are not configured."
      });
    }

    const { phone, amount } = req.body;

    if (!/^254[17]\d{8}$/.test(String(phone))) {
      return res.status(400).json({
        error: "Enter a valid Kenyan phone number, e.g. 2547XXXXXXXX."
      });
    }

    if (![500, 1500, 2500].includes(Number(amount))) {
      return res.status(400).json({
        error: "Invalid ticket price."
      });
    }

    const credentials = Buffer.from(
      `${DARAJA_CONSUMER_KEY}:${DARAJA_CONSUMER_SECRET}`
    ).toString("base64");

    const authResponse = await fetch(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${credentials}`
        }
      }
    );

    const auth = await authResponse.json();

    if (!authResponse.ok || !auth.access_token) {
      return res.status(502).json({
        error: "Could not authenticate with Daraja."
      });
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      `${DARAJA_SHORTCODE}${DARAJA_PASSKEY}${timestamp}`
    ).toString("base64");

    const stkResponse = await fetch(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          BusinessShortCode: DARAJA_SHORTCODE,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerPayBillOnline",
          Amount: Number(amount),
          PartyA: phone,
          PartyB: DARAJA_SHORTCODE,
          PhoneNumber: phone,
          CallBackURL: CALLBACK_URL,
          AccountReference: "GOLDENPEN",
          TransactionDesc: "Golden Pen Show Ticket"
        })
      }
    );

    const result = await stkResponse.json();

    return res.status(stkResponse.ok ? 200 : 502).json(result);

  } catch (error) {
    return res.status(500).json({
      error: "Payment request failed."
    });
  }
});

app.post("/api/callback", (req, res) => {
  console.log("Daraja callback received:", JSON.stringify(req.body));
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Golden Pen server running on port ${PORT}`);
});

app.get("/checkout", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Golden Pen Show Tickets</title>
      <style>
        body {
          font-family: Arial;
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

        <button onclick="pay()">PAY WITH M-PESA</button>
        <p id="message"></p>
      </div>

      <script>
        async function pay() {
          const message = document.getElementById("message");
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

          message.textContent = "Sending sandbox payment request...";

          try {
            const response = await fetch("/api/stkpush", {
              method: "POST",
              headers: {"Content-Type": "application/json"},
              body: JSON.stringify({phone, amount})
            });

            const result = await response.json();

            message.textContent = response.ok
              ? "Request response received. Check your test result."
              : (result.error || "Payment request failed.");

          } catch (error) {
            message.textContent = "Connection error. Please try again.";
          }
        }
      </script>
    </body>
    </html>
  `);
});

      
