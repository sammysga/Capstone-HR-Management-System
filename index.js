const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer'); // Add multer for file uploads
const routes = require('./routes/routes.js');

const app = express();
const port = 4000;

// Middleware for file uploads
const upload = multer({ dest: 'uploads/' }); // Specify the directory to store uploaded files

app.use(bodyParser.json()); 

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files from the 'scripts' directory
app.use('/scripts', express.static(path.join(__dirname, 'scripts'))); // Updated to serve scripts from your local 'scripts' directory


// Parse incoming requests with URL-encoded payloads and JSON
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Set the view engine to 'ejs'
app.set('view engine', 'ejs');

// Update the views directory for EJS templates
app.set('views', path.join(__dirname, 'public/views'));


// Session configuration
// app.use(session({
//     secret: 'secret-key',  
//     resave: false,
//     saveUninitialized: true,
//     cookie: {
//         maxAge: null, // or a very large value like 10 years in milliseconds: 10 * 365 * 24 * 60 * 60 * 1000
//         secure: false, // Set to true if your app is served over HTTPS
//         httpOnly: true, // This is recommended to prevent client-side JavaScript from accessing the cookie
//     }
// }));

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } 
}));
// Flash middleware
app.use(flash());

// Middleware to make flash messages available in all views
app.use((req, res, next) => {
    res.locals.messages = req.flash();
    next();
});

// Use the routes defined in the 'routes' directory
// Add route for file upload handling
app.post('/upload', upload.single('file'), (req, res) => {
    if (req.file) {
        console.log('File uploaded:', req.file);
        res.json({ message: 'File uploaded successfully', file: req.file });
    } else {
        res.status(400).json({ message: 'No file uploaded' });
    }
});

// Use the routes defined in the 'routes' directory
app.use('/', routes);


// Start the server and listen on the specified port
app.listen(port, (error) => {
    if (error) {
        console.log('Something went wrong', error);
    } else {
        console.log(`Server is running on http://localhost:${port}`);
    }
});