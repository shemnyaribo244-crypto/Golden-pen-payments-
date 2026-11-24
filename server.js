
const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Golden Pen Show payment server is running.");
});

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
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
        function pay() {
          document.getElementById("message").textContent =
            "Checkout page is ready. M-Pesa payment connection is not yet configured.";
        }
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Golden Pen server running on port ${PORT}`);
});
