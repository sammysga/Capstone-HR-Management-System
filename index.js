const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer'); // Add multer for file uploads
const routes = require('./routes/routes.js');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js'); // Import Supabase client

const app = express();
const port = 4000;

// Initialize Supabase client with your Supabase URL and API Key
const supabaseUrl = 'https://amzzxgaqoygdgkienkwf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtenp4Z2Fxb3lnZGdraWVua3dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjQzMjk0MzUsImV4cCI6MjAzOTkwNTQzNX0.1GdKI-d9CnJoLn0-T_VdM2Pd75PVHzAYOPIg_f7sgDQ';
const supabase = createClient(supabaseUrl, supabaseKey);


// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Save the file to the 'uploads' folder
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);  // Create uploads folder if it doesn't exist
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Ensure the filename is unique (by using the original filename + timestamp)
        cb(null, Date.now() + '-' + file.originalname);
    }
});

// Create multer upload instance for handling single PDF file
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Only allow PDF files
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files are allowed'), false);
        }
        cb(null, true);
    }
});

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
// Define the route to handle file upload
// Define the route to handle file upload to Supabase
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        // Read the file from the multer storage as a buffer
        const fileBuffer = fs.readFileSync(req.file.path); // Read file as buffer

        // Upload the file to Supabase bucket
        const { data, error } = await supabase.storage
            .from('uploads') // Your bucket name is 'uploads'
            .upload(`pdfs/${Date.now()}-${req.file.originalname}`, fileBuffer, {
                contentType: req.file.mimetype
            });

        // Delete the local file after uploading
        fs.unlinkSync(req.file.path);  // Clean up the temporary file from the server

        if (error) {
            return res.status(500).json({ message: `Error uploading file: ${error.message}` });
        }

        // Get the file's public URL (optional if you want to make it publicly accessible)
        const fileUrl = supabase.storage.from('uploads').getPublicUrl(data.path).publicURL;

        // Send the response with the file URL
        res.json({ filename: data.path, url: fileUrl });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ message: 'There was an error uploading your file.' });
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