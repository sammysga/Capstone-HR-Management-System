const express = require('express');
const router = express.Router();
const applicantController = require('../controllers/applicantController');
const staffLoginController = require('../controllers/staffloginController');
const hrController = require('../controllers/hrController');



// Middleware to parse incoming request bodies
router.use(express.urlencoded({ extended: true }));


// Route to render the public home page
router.get('/', applicantController.getPublicHome);
router.get('/applicant_signup', applicantController.getPublicSignUp);
router.post('/applicant_signup_submit', applicantController.handleRegisterPage);
router.get('/login/staff', staffLoginController.getStaffLogin);
router.post('/login/staff', staffLoginController.postStaffLogin);

// Protected routes (role-specific logic in respective controllers)
router.get('/hr/dashboard', hrController.getHRDashboard);
router.get('/hr/managestaff', hrController.getHRManageStaff);




module.exports = router;

