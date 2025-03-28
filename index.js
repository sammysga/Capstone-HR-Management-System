const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const routes = require('./routes/routes.js');
const axios = require('axios'); // Add axios for API requests
require('dotenv').config()

const app = express();
const port = 4000;

// Increase the JSON payload size limit for Calendly webhooks
app.use(bodyParser.json({ limit: '10mb' })); 

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

// Function to set up Calendly webhook (can be run once or on app startup)
async function setupCalendlyWebhook() {
    try {
        // Your Calendly Personal Access Token
        const token = 'eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNzQzMTI3NzE0LCJqdGkiOiI5OTZiZDdmNS0xZjQwLTRhMTMtOWU4Yi00NzJjNzQxZTM0ZGIiLCJ1c2VyX3V1aWQiOiI3ODI1MzJiMC01ZTE5LTRlNWYtOWE4Ny1hYjdjMjM5ZjBkYTAifQ.fSaykMkl6pR2eQQSKFn_UU8r3LH46Wqmu9M5LNuJ0ZvfBrTv5ibxQnt8NFlPG4P7r4OqFfcByQO_3uOQ82VKVQ';

        // Get the server's base URL
        // For production, use your actual domain; for development with ngrok, use your ngrok URL
        const serverBaseUrl = 'https://b296-2001-4451-4777-df00-613d-d384-71f-6c95.ngrok-free.app';
        const webhookUrl = `${serverBaseUrl}/api/webhooks/calendly`;

        console.log('Attempting to set up Calendly webhook at:', webhookUrl);

        // 1. First get the current user's organization
        const userResponse = await axios.get('https://api.calendly.com/users/me', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const currentUser = userResponse.data;
        console.log('Current Calendly user:', currentUser.resource.name);
        
        // Get the organization URI from the current user
        const organizationUri = currentUser.resource.current_organization;
        console.log('Organization URI:', organizationUri);
        
        // Check if webhook already exists
        const existingWebhooks = await axios.get('https://api.calendly.com/webhook_subscriptions', {
            params: {
                organization: organizationUri,
                scope: 'organization'
            },
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // Look for a webhook with the same URL
        const existingWebhook = existingWebhooks.data.collection.find(
            webhook => webhook.callback_url === webhookUrl
        );

        if (existingWebhook) {
            console.log('Webhook already exists:', existingWebhook.uri);
            return existingWebhook;
        }
        
        // 2. Create the webhook if it doesn't exist
        const webhookResponse = await axios.post('https://api.calendly.com/webhook_subscriptions', {
            url: webhookUrl,
            events: ['invitee.created', 'invitee.canceled'],
            organization: organizationUri,
            scope: 'organization'
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Webhook created successfully:', webhookResponse.data);
        console.log('Webhook UUID:', webhookResponse.data.resource.uri.split('/').pop());
        
        return webhookResponse.data;
    } catch (error) {
        console.error('Error setting up Calendly webhook:', error.response?.data || error.message);
        // We don't want to crash the server if webhook setup fails
        return null;
    }
}

// Run webhook setup once the server is ready
// Comment this out after the webhook is successfully created
app.on('listening', () => {
    // Only run in production or when explicitly requested
    if (process.env.NODE_ENV === 'production' || process.env.SETUP_CALENDLY_WEBHOOK === 'true') {
        console.log('Setting up Calendly webhook...');
        setupCalendlyWebhook()
            .then(() => console.log('Calendly webhook setup complete'))
            .catch(err => console.error('Failed to set up Calendly webhook:', err));
    }
});

// Use the routes defined in the 'routes' directory
app.use('/', routes);

// Start the server and listen on the specified port
const server = app.listen(port, (error) => {
    if (error) {
        console.log('Something went wrong', error);
    } else {
        console.log(`Server is running on http://localhost:${port}`);
        // Emit the 'listening' event to trigger webhook setup
        app.emit('listening');
    }
});