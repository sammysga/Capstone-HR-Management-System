const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const routes = require('./routes/routes.js');

const app = express();
const port = 4000;

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

// Session configuration
app.use(session({
    secret: 'your-secret-key', // Use a strong secret key
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // Set cookie expiration to 1 week (adjust as needed)
        secure: false, // Set to true if your app is served over HTTPS
        httpOnly: true, // Prevent client-side JavaScript from accessing the cookie
    }
}));

// Flash middleware
app.use(flash());

// Middleware to make flash messages available in all views
app.use((req, res, next) => {
    res.locals.messages = req.flash();
    next();
});

// Use the routes defined in the 'routes' directory
app.use('/', routes);

// Global error handler for email-related errors
app.use((error, req, res, next) => {
    if (error.message && error.message.includes('email')) {
        console.error('❌ [Email Error]:', error);
        return res.status(500).json({
            success: false,
            message: 'Email service error occurred',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
    next(error);
});

// Start the server and listen on the specified port
app.listen(port, (error) => {
    if (error) {
        console.log('Something went wrong', error);
    } else {
        console.log(`🚀 Server is running on http://localhost:${port}`);
        
        // Check email configuration on startup
        const emailConfigured = !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
        
        if (emailConfigured) {
            console.log('✅ Email service configured and ready');
            console.log(`📧 Using email: ${process.env.EMAIL_USER}`);
            console.log(`📨 SMTP Host: ${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT}`);
        } else {
            console.log('⚠️  Email service not fully configured');
            console.log('   Please check your .env file for EMAIL_HOST, EMAIL_USER, and EMAIL_PASS');
        }
        
        // Email test routes are available in your routes file
    }
});