// Import the http module
const http = require('http');

// Define the server
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Hello, World!\n');
});

// Specify the port and start the server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
