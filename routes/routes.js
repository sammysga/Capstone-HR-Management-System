const express = require('express');
const router = express.Router();
const applicantController = require('../controllers/applicantController');


// Route to render the public home page
router.get('/', applicantController.getPublicHome);
router.get('/applicant_signup', applicantController.getPublicSignUp);

module.exports = router;

