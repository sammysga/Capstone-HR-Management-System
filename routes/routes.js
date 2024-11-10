const express = require('express');
const router = express.Router();
const applicantController = require('../controllers/applicantController');
const staffLoginController = require('../controllers/staffloginController');
const hrController = require('../controllers/hrController');
const employeeController = require('../controllers/employeeController');
const lineManagerController = require('../controllers/lineManagerController');
const chatbotController = require('../controllers/chatbotController');


// Middleware to parse incoming request bodies
router.use(express.urlencoded({ extended: true }));


// Route to render the public home page
router.get('/', applicantController.getPublicHome);
router.get('/applicant/signup', applicantController.getApplicantRegisterPage);
router.post('/applicant/signup', applicantController.handleRegisterPage);
router.get('/applicant/login', applicantController.getApplicantLogin);
router.post('/applicant/login', applicantController.handleLoginSubmit);

// Applicant 
router.get('/about', applicantController.getAboutPage);
router.get('/jobrecruitment', applicantController.getJobRecruitment);
router.get('/contactform', applicantController.getContactForm);
router.get('/job-details/:jobId', applicantController.getJobDetails);
// router.get('/chatbothome', applicantController.getChatbotPage);
router.get('/employeechatbothome', applicantController.getInternalApplicantChatbotPage);

// Chatbot routes
router.get('/chatbothome', chatbotController.getChatbotPage);
router.post('/chatbot', chatbotController.handleChatbotMessage);

// Staff Log in
router.get('/staff/login', staffLoginController.getStaffLogin);
router.post('/staff/login', staffLoginController.postStaffLogin);

// Protected routes (role-specific logic in respective controllers)
router.get('/hr/dashboard', hrController.getHRDashboard);
router.get('/hr/manageleavetypes', hrController.getManageLeaveTypes);
router.get('/hr/managestaff', hrController.getHRManageStaff);
router.get('/hr/api/departments', hrController.getDepartments);
router.get('/hr/api/job-titles', hrController.getJobTitles);
router.post('/hr/api/departments', hrController.addNewDepartment);
router.post('/hr/api/job-titles', hrController.addNewJobTitle);
router.post('/hr/api/add-staff', hrController.addNewStaff);
router.put('/hr/api/update-leavetypes/:leaveTypeId', hrController.updateLeaveTypes); // Ensure leaveTypeId is included in the URL


router.get('/hr/useraccount', hrController.getUserAccount);
router.post('/hr/update-info', hrController.updateUserInfo);
router.get('/employee/persinfocareerprog', hrController.getPersInfoCareerProg); // copied this url since HR is an employee
router.post('/employee/update-persinfo', hrController.updatePersUserInfo);

router.get('/hr/leaverequest', hrController.getLeaveRequestForm);
router.post('/hr/leaverequest', hrController.submitLeaveRequest);

router.get('/hr/managehome', hrController.getHRManageHome); 
router.get('/hr/addannouncement', hrController.getAddAnnouncement);
router.post('/hr/addannouncement', hrController.postAddAnnouncement);
router.get('/hr/editannouncement/:announcementID', hrController.getEditAnnouncement);
router.post('/hr/editannouncement/:announcementID', hrController.updateAnnouncement);
router.delete('/hr/deleteannouncement/:announcementID', hrController.deleteAnnouncement);
router.get('/hr/joboffers', hrController.getJobOffers);
router.get('/hr/addjoboffer', hrController.getAddJobOffer);
router.post('/hr/addjoboffer', hrController.postAddJobOffer);
router.get('/hr/editjoboffers', hrController.getEditJobOffers);
router.get('/hr/records-performance-tracker', hrController.getRecordsPerformanceTracker);
router.get('/hr/records-performance-tracker/:userId', hrController.getRecordsPerformanceTrackerByUserId);


router.get('/logout', hrController.getLogoutButton);
router.get('/logout', lineManagerController.getLogoutButton);


// Employee Routes
router.get('/employee/dashboard', employeeController.getEmployeeDashboard);
router.get('/employee/useracc', employeeController.getUserAccount);
router.get('/employee/employeeoffboarding', employeeController.getEmployeeOffboarding);
router.get('/employee/employeepersinfocareerprog', employeeController.getPersInfoCareerProg);
router.get('/employee/employeeobjectivebasedprog', employeeController.getEmployeeObjProg);
router.get('/employee/employeeskillsproggapanal', employeeController.getEmployeeSKillsProg);


router.post('/employee/employeepersinfocareerprog/editpersonalinfo', employeeController.editPersonalInformation);
router.post('/employee/employeepersinfocareerprog/editcareerprog', employeeController.editCareerProgression);
router.post('/employee/employeepersinfocareerprog/editdeginfo', employeeController.editDegreeInformation);
router.post('/employee/employeepersinfocareerprog/editexperiences', employeeController.editExperiences);
router.post('/employee/employeepersinfocareerprog/editcertifations', employeeController.editCertifications);
router.post('/employee/reset-password', employeeController.resetPassword);
router.post('/employee/update-info', employeeController.updateUserInfo);
router.post('/employee/update-persinfo', employeeController.updatePersUserInfo);



router.get('/employee/leaverequest', employeeController.getLeaveRequestForm); // To load the form
router.post('/employee/leaverequest', employeeController.submitLeaveRequest); // To submit a leave request
router.get('/employee/leaverequest/requests', employeeController.getLeaveRequestsByUserId); // To get leave requests
router.post('/employee/leaverequest', employeeController.postLeaveBalancesByUserId); // To get leave balances
router.get('/employee/leaverequest/pending', employeeController.fetchPendingRequestsCount);

router.get('/employee/viewtimeline', employeeController.getViewPerformanceTimeline);


router.get('/employee/attendance', employeeController.getAttendance);
router.post('/employee/attendance', employeeController.postAttendance);



// Line Manager Routes

// Staff information
router.get('/linemanager/dashboard', lineManagerController.getLineManagerDashboard);
router.get('/linemanager/leaverequest', lineManagerController.getLeaveRequest); // Fetch leave request
router.post('/linemanager/leaverequest/update', lineManagerController.updateLeaveRequest); // Update leave request

router.get('/linemanager/useraccount', lineManagerController.getUserAccount);
router.post('/linemanager/update-info', lineManagerController.updateUserInfo);
router.get('/linemanager/persinfocareerprog', lineManagerController.getPersInfoCareerProg); // copied this url since HR is an employee
router.post('/linemanager/update-persinfo', lineManagerController.updatePersUserInfo);

router.get('/linemanager/mrf', lineManagerController.getMRF);
router.get('/linemanager/request-mrf', lineManagerController.getRequestMRF);
router.get('/linemanager/mrf-list', lineManagerController.getMRFList);
router.post('/linemanager/request-mrf', lineManagerController.submitMRF);
router.get('/linemanager/records-performance-tracker', lineManagerController.getRecordsPerformanceTrackerByDepartmentId);
router.get(
    '/linemanager/records-performance-tracker/:userId',
    lineManagerController.getRecordsPerformanceTrackerByUserId,
    lineManagerController.getUserProgressView
);
router.post('/linemanager/records-performance-tracker/:userId', lineManagerController.saveObjectiveSettings);

module.exports = router; 

