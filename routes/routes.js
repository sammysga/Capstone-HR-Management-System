const express = require('express');
const router = express.Router();
const applicantController = require('../controllers/applicantController');
const staffLoginController = require('../controllers/staffloginController');
const hrController = require('../controllers/hrController');
const employeeController = require('../controllers/employeeController');
const lineManagerController = require('../controllers/lineManagerController');



// Middleware to parse incoming request bodies
router.use(express.urlencoded({ extended: true }));


// Route to render the public home page
router.get('/', applicantController.getPublicHome);
router.get('/applicant_signup', applicantController.getPublicSignUp);
router.post('/applicant_signup_submit', applicantController.handleRegisterPage);
router.get('/login/staff', staffLoginController.getStaffLogin);
router.post('/login/staff', staffLoginController.postStaffLogin);

// Applicant 
router.get('/about', applicantController.getAboutPage);
router.get('/jobrecruitment', applicantController.getJobRecruitment);
router.get('/contactform', applicantController.getContactForm);
router.get('/applicantlogin', applicantController.getApplicantLogin);
router.get('/applicantsignup', applicantController.getApplicantSignup);
router.get('/jobdetails/:jobOfferUUID', applicantController.getJobDetails);

// Protected routes (role-specific logic in respective controllers)
router.get('/hr/dashboard', hrController.getHRDashboard);
router.get('/hr/managestaff', hrController.getHRManageStaff);
router.get('/hr/api/departments', hrController.getDepartments);
router.get('/hr/api/job-titles', hrController.getJobTitles);
router.post('/hr/api/departments', hrController.addNewDepartment);
router.post('/hr/api/job-titles', hrController.addNewJobTitle);
router.post('/hr/api/add-staff', hrController.addNewStaff);

router.get('/hr/managehome', hrController.getHRManageHome); 
router.get('/hr/addannouncement', hrController.getAddAnnouncement);
router.post('/hr/addannouncement', hrController.postAddAnnouncement);
router.get('/hr/joboffers', hrController.getJobOffers);


// Employee Routes
router.get('/employee/dashboard', employeeController.getEmployeeDashboard);


// Lina Manager Routes
router.get('/linemanager/dashboard', lineManagerController.getLineManagerDashboard);



module.exports = router;

