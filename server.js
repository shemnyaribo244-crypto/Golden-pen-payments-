const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3000;
const MPESA_NUMBER = "0729522634";

const TICKETS = {
  500: "Regular",
  1500: "VIP",
  2500: "VVIP"
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function adminAuth(req, res, next) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const header = req.headers.authorization || "";

  if (!username || !password) {
    return res.status(503).send("Admin login is not configured.");
  }

  try {
    if (header.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");

      if (separator >= 0) {
        const user = decoded.slice(0, separator);
        const pass = decoded.slice(separator + 1);

        if (
          user.length === username.length &&
          pass.length === password.length &&
          crypto.timingSafeEqual(Buffer.from(user), Buffer.from(username)) &&
          crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(password))
        ) return next();
      }
    }
  } catch {}

  res.set("WWW-Authenticate", 'Basic realm="Golden Pen Admin"');
  return res.status(401).send("Admin login required.");
}

app.get("/", (req, res) => {
  res.send("Golden Pen Show payment server is running.");
});

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

// Customer checkout
app.get("/checkout", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Golden Pen Show Tickets</title>
<style>
body{font-family:Arial;background:#111;color:white;padding:20px;text-align:center}
.box{max-width:420px;margin:30px auto;padding:22px;background:#222;border-radius:14px}
select,input,button{width:100%;padding:14px;margin:10px 0;box-sizing:border-box;border-radius:7px;font-size:16px}
button{background:#d6a32a;border:0;font-weight:bold}
.number{font-size:24px;color:#f2c14e;font-weight:bold}
#message{white-space:pre-wrap}
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
<p>Send your payment to this M-PESA number:</p>
<p class="number">${MPESA_NUMBER}</p>
<p>After paying, enter your phone number and M-PESA transaction code below.</p>
<input id="phone" placeholder="Your M-PESA phone number">
<input id="receipt" placeholder="M-PESA transaction code">
<button id="submitButton" onclick="submitPayment()">SUBMIT PAYMENT DETAILS</button>
<p id="message"></p>
</div>
<script>
async function submitPayment(){
 const message=document.getElementById("message");
 const button=document.getElementById("submitButton");
 let phone=document.getElementById("phone").value.trim();
 const receipt=document.getElementById("receipt").value.trim().toUpperCase();
 const amount=Number(document.getElementById("amount").value);

 if(phone.startsWith("+254")) phone=phone.substring(1);
 else if(phone.startsWith("0")) phone="254"+phone.substring(1);

 if(!/^254[17]\\d{8}$/.test(phone)){
   message.textContent="Enter a valid Kenyan phone number.";return;
 }
 if(!/^[A-Z0-9]{8,15}$/.test(receipt)){
   message.textContent="Enter a valid M-PESA transaction code.";return;
 }

 button.disabled=true;
 message.textContent="Submitting your payment details...";
 try{
   const response=await fetch("/api/manual-payment",{
     method:"POST",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({phone,receipt,amount})
   });
   const result=await response.json();
   if(!response.ok) throw new Error(result.error||"Submission failed.");
   message.textContent="Payment details received. Your payment is PENDING VERIFICATION. Your ticket will be issued after the seller confirms payment.";
 }catch(error){
   message.textContent=error.message;
 }finally{
   button.disabled=false;
 }
}
</script>
</body>
</html>
  `);
});

// Save customer's submitted payment details
app.post("/api/manual-payment", async (req, res) => {
  try {
    const phone = String(req.body.phone || "");
    const receipt = String(req.body.receipt || "").trim().toUpperCase();
    const amount = Number(req.body.amount);

    if (!/^254[17]\d{8}$/.test(phone))
      return res.status(400).json({error:"Invalid phone number."});

    if (!/^[A-Z0-9]{8,15}$/.test(receipt))
      return res.status(400).json({error:"Invalid transaction code."});

    if (!Object.prototype.hasOwnProperty.call(TICKETS, amount))
      return res.status(400).json({error:"Invalid ticket amount."});

    const {data:existing} = await supabase
      .from("ticket_sales")
      .select("id")
      .eq("submitted_receipt", receipt)
      .maybeSingle();

    if (existing)
      return res.status(409).json({error:"This transaction code has already been submitted."});

    const {error} = await supabase.from("ticket_sales").insert({
      checkout_request_id:"MANUAL-" + crypto.randomUUID(),
      customer_phone:phone,
      ticket_type:TICKETS[amount],
      amount,
      payment_status:"pending",
      submitted_receipt:receipt
    });

    if (error) {
      console.error(error.message);
      return res.status(500).json({error:"Could not save payment details. Please contact the seller."});
    }

    res.json({success:true});
  } catch(error) {
    console.error(error.message);
    res.status(500).json({error:"Server error."});
  }
});

// Admin approves a payment after checking M-PESA
app.post("/admin/approve/:id", adminAuth, async (req, res) => {
  try {
    const {data:payment,error} = await supabase
      .from("ticket_sales")
      .select("*")
      .eq("id",req.params.id)
      .eq("payment_status","pending")
      .maybeSingle();

    if(error || !payment || !payment.submitted_receipt)
      return res.status(400).send("Payment not found or already processed.");

    const {data:duplicate} = await supabase
      .from("ticket_sales")
      .select("id")
      .eq("mpesa_receipt",payment.submitted_receipt)
      .maybeSingle();

    if(duplicate)
      return res.status(409).send("This M-PESA receipt has already been approved.");

    const ticketCode = "GPS-" + crypto.randomUUID().slice(0,8).toUpperCase();

    const {error:updateError} = await supabase
      .from("ticket_sales")
      .update({
        payment_status:"paid",
        mpesa_receipt:payment.submitted_receipt,
        ticket_code:ticketCode
      })
      .eq("id",payment.id)
      .eq("payment_status","pending");

    if(updateError) throw updateError;

    res.redirect("/admin");
  } catch(error) {
    console.error(error.message);
    res.status(500).send("Could not approve payment.");
  }
});

// Admin rejects a payment
app.post("/admin/reject/:id", adminAuth, async (req, res) => {
  const {error} = await supabase
    .from("ticket_sales")
    .update({payment_status:"failed"})
    .eq("id",req.params.id)
    .eq("payment_status","pending");

  if(error) return res.status(500).send("Could not reject payment.");
  res.redirect("/admin");
});

// Private sales dashboard
app.get("/admin", adminAuth, async (req, res) => {
  res.set("Cache-Control","no-store");

  const {data:sales,error} = await supabase
    .from("ticket_sales")
    .select("*")
    .order("created_at",{ascending:false})
    .limit(500);

  if(error) return res.status(500).send("Could not load ticket sales.");

  const paid = sales.filter(s=>s.payment_status==="paid");
  const total = paid.reduce((sum,s)=>sum+Number(s.amount),0);
  const pending = sales.filter(s=>s.payment_status==="pending");

  const rows = sales.map(s=>`
    <tr>
      <td>${escapeHTML(s.customer_phone)}</td>
      <td>${escapeHTML(s.ticket_type)}</td>
      <td>KSh ${Number(s.amount).toLocaleString("en-KE")}</td>
      <td>${escapeHTML(s.submitted_receipt || "-")}</td>
      <td>${escapeHTML(s.payment_status)}</td>
      <td>${escapeHTML(s.mpesa_receipt || "-")}</td>
      <td>${escapeHTML(s.ticket_code || "-")}</td>
      <td>
        ${s.payment_status==="pending" ? `
          <form method="POST" action="/admin/approve/${encodeURIComponent(s.id)}">
            <button type="submit">Approve</button>
          </form>
          <form method="POST" action="/admin/reject/${encodeURIComponent(s.id)}">
            <button type="submit">Reject</button>
          </form>` : "-"}
      </td>
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
table{border-collapse:collapse;width:100%;min-width:950px}
th,td{padding:10px;border-bottom:1px solid #444;text-align:left}
th{color:#d6a32a}
.tablewrap{overflow-x:auto;margin-top:20px}
button{padding:9px;background:#d6a32a;border:0;border-radius:5px;font-weight:bold}
small{color:#bbb}
</style>
</head>
<body>
<h1>GOLDEN PEN SHOW</h1>
<h2>Private Sales Dashboard</h2>
<div class="cards">
<div class="card"><h3>Total collected</h3><h2>KSh ${total.toLocaleString("en-KE")}</h2></div>
<div class="card"><h3>Paid tickets</h3><h2>${paid.length}</h2></div>
<div class="card"><h3>Pending payments</h3><h2>${pending.length}</h2></div>
<div class="card"><h3>Records shown</h3><h2>${sales.length}</h2></div>
</div>
<p><small>Only approve a payment after verifying the transaction in your M-PESA account.</small></p>
<div class="tablewrap">
<table>
<thead><tr>
<th>Phone</th><th>Ticket</th><th>Amount</th><th>Submitted code</th>
<th>Status</th><th>Verified receipt</th><th>Ticket code</th><th>Action</th>
</tr></thead>
<tbody>${rows || "<tr><td colspan='8'>No sales recorded yet.</td></tr>"}</tbody>
</table>
</div>
</body>
</html>
  `);
});

app.get("/ticket", (req, res) => {
  res.send(`
    <h2>Golden Pen Show – Check Your Ticket</h2>
    <p>Enter the phone number and M-PESA transaction code used during payment.</p>
    <form id="ticketForm">
      <input name="phone" placeholder="Phone number" required />
      <br><br>
      <input name="receipt" placeholder="M-PESA transaction code" required />
      <br><br>
      <button type="submit">Check Ticket</button>
    </form>
    <p id="result"></p>
    <script>
      document.getElementById("ticketForm").onsubmit = async function(e) {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(this));
        const result = document.getElementById("result");
        result.textContent = "Checking...";
        try {
          const response = await fetch("/api/ticket-lookup", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(data)
          });
          const answer = await response.json();
          result.textContent = answer.message || (
            answer.status === "paid"
              ? "Payment confirmed! Ticket: " + answer.ticketCode + " (" + answer.ticketType + ")"
              : "Payment status: " + answer.status
          );
        } catch {
          result.textContent = "Unable to check. Please try again.";
        }
      };
    </script>
  `);
});

app.post("/api/ticket-lookup", async (req, res) => {
  const phone = String(req.body.phone || "").replace(/\s/g, "");
  const receipt = String(req.body.receipt || "").trim().toUpperCase();

  if (!/^(\+254|254|0)7\d{8}$/.test(phone) || !/^[A-Z0-9]{8,12}$/.test(receipt)) {
    return res.status(400).json({message: "Enter a valid phone number and M-PESA code."});
  }

  const {data, error} = await supabase
    .from("ticket_sales")
    .select("payment_status,ticket_code,ticket_type")
    .eq("customer_phone", phone)
    .eq("submitted_receipt", receipt)
    .maybeSingle();

  if (error) return res.status(500).json({message: "Unable to check right now."});
  if (!data) return res.status(404).json({message: "No matching payment record found."});

  if (data.payment_status === "paid") {
    return res.json({
      status: "paid",
      ticketCode: data.ticket_code,
      ticketType: data.ticket_type
    });
  }

  return res.json({
    status: data.payment_status === "pending" ? "pending" : "not confirmed",
    message: data.payment_status === "pending"
      ? "Your payment is awaiting verification."
      : "Payment has not been confirmed. Please contact the ticket seller."
  });
});app.listen(PORT,()=>{
  console.log("Golden Pen server running on port "+PORT);
});
