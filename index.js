const express = require('express');
const app = express();
const hbs = require('hbs');
const bodyParser = require('body-parser');
const routes = require('./routes/routes.js');

const port = 4000;

//TODO: Install Session
// const session = require('express-session');

// Set up session middleware
// app.use(session({
//     secret: 'secret-key',  
//     resave: false,
//     saveUninitialized: true,
//     cookie: {
//         maxAge: null, // Set maxAge as needed, or null for a session cookie
//         secure: false, // Set to true if your app is served over HTTPS
//         httpOnly: true, // Recommended to prevent client-side JavaScript from accessing the cookie
//     }
// }));

// Serve static files from the 'public' directory
app.use(express.static(__dirname + '/public'));

// Parse incoming requests with URL-encoded payloads and JSON
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Set the view engine to 'hbs'
app.set('view engine', 'hbs');

// Update the views directory to include the main views and partials directory
app.set('views', [__dirname + '/public/views', __dirname + '/public/views/partials']);

// Register all partials in the specified directory
hbs.registerPartials(__dirname + '/public/views/partials');

// Register the 'eq' helper
hbs.registerHelper('eq', function (a, b) {
    return a === b;
});

// Define a custom helper to convert JavaScript objects to JSON strings
hbs.registerHelper('json', function(context) {
    return JSON.stringify(context);
});

// Log registered partials
const partials = hbs.partials;
console.log('Registered Partials:', Object.keys(partials || {}));

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
