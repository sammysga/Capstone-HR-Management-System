const express = require('express');
const router = express.Router();
const applicantController = require('../controllers/applicantController');

// Middleware to parse incoming request bodies
router.use(express.urlencoded({ extended: true }));


// Route to render the public home page
router.get('/', applicantController.getPublicHome);
router.get('/applicant_signup', applicantController.getPublicSignUp);
router.post('/applicant_signup_submit', applicantController.handleRegisterPage);



module.exports = router;

