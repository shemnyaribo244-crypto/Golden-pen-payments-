
const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Golden Pen Show payment server is running.");
});

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Golden Pen server running on port ${PORT}`);
});
