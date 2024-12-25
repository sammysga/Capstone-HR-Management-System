const express = require('express');
const router = express.Router();
const applicantController = require('../controllers/applicantController');
const staffLoginController = require('../controllers/staffloginController');
const hrController = require('../controllers/hrController');
const employeeController = require('../controllers/employeeController');
const lineManagerController = require('../controllers/lineManagerController');
const chatbotController = require('../controllers/chatbotController');
const fileUpload = require('express-fileupload');  // Make sure you've installed express-fileupload
// Middleware to parse incoming request bodies
router.use(express.urlencoded({ extended: true }));
router.use(fileUpload());


// Route to render the public home page
router.get('/', applicantController.getAboutPage);
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
router.get('/onboarding', applicantController.getOnboarding);
router.get('/onboarding/employee-records', applicantController.getOnboardingEmployeeRecords);
router.get('/onboarding/osd-wait', applicantController.getOnboardingWaitOSD);
router.get('/onboarding/objective-setting-view', applicantController.getOnboardingObjectiveSetting);

// Chatbot routes
router.get('/chatbothome', chatbotController.getChatbotPage);
router.post('/chatbot', chatbotController.handleChatbotMessage);
router.post('/upload', chatbotController.handleFileUpload); // Directly use the controller method for file handling

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
router.get('/hr/editjoboffers/:id', hrController.getEditJobOffers);
router.post('/hr/editjoboffers/:id', hrController.updateJobOffer);
router.get('/hr/records-performance-tracker', hrController.getRecordsPerformanceTracker);
router.get('/hr/records-performance-tracker/:userId', hrController.getRecordsPerformanceTrackerByUserId);
router.get('/hr/view-mrf/:id', hrController.getViewMRF);
router.post('/hr/view-mrf/:id', hrController.submitMRF);
router.get('/hr/applicant-tracker', hrController.getApplicantTracker);

router.get('/hr/applicant-tracking', hrController.getApplicantTracking);
router.get('/hr/view-final-results/:userId', hrController.getFinalResults);
router.get('/hr/evaluation-form', hrController.getEvaluationForm);

router.get('/hr/offboarding-request', hrController.getOffboardingRequest);

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
router.post('/employee/employeeoffboarding', employeeController.postEmployeeOffboarding);



router.get('/employee/leaverequest', employeeController.getLeaveRequestForm); // To load the form
router.post('/employee/leaverequest', employeeController.submitLeaveRequest); // To submit a leave request
router.get('/employee/leaverequest/requests', employeeController.getLeaveRequestsByUserId); // To get leave requests
router.post('/employee/leaverequest', employeeController.postLeaveBalancesByUserId); // To get leave balances
router.get('/employee/leaverequest/pending', employeeController.fetchPendingRequestsCount);

router.get('/employee/viewtimeline', employeeController.getViewPerformanceTimeline);


router.get('/employee/attendance', employeeController.getAttendance);
router.post('/employee/attendance', employeeController.postAttendance);
router.get('/employee/api/get360Feedback', employeeController.get360FeedbackToast);
// router.get('/employee/employeefeedbackquestionnaire', employeeController.get360FeedbackList);
// router.get('/employee/employeefeedbackquestionnaire/:selectedUser Id', employeeController.get360FeedbackList);
router.get('/logout', employeeController.getLogoutButton);

// Route to fetch the list of users for feedback
router.get('/employee/employeefeedbackquestionnaire', employeeController.getFeedbackUsers);

// Route to fetch the feedback form for a specific user and quarter
router.get('/employee/employeefeedbackquestionnaire/:selectedUserId', employeeController.get360FeedbackList);

// Route to submit the feedback
// router.post('/employee/employeefeedbackquestionnaire/:selectedUser Id/submit', employeeController.submitFeedback);

// Line Manager Routes
router.get('/linemanager/interview-bookings', lineManagerController.getInterviewBookings);
router.get('/linemanager/interview-bookingss', lineManagerController.getInterviewBookingss);

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

router.get('/linemanager/records-performance-tracker/:userId', lineManagerController.getRecordsPerformanceTrackerByUserId);
router.get('/linemanager/interview-form', lineManagerController.getApplicantTracker);

router.get('/linemanager/offboarding-requests', lineManagerController.getOffboardingRequestsDash);
router.get('/linemanager/view-offboarding-request/:userId', lineManagerController.getViewOffboardingRequest);


// Route for viewing an employee's performance tracker with a quarter
// router.get('/linemanager/records-performance-tracker/:userId/:quarter',
//     lineManagerController.fetchFeedbackData,
//     lineManagerController.getUserProgressView);
router.get('/linemanager/records-performance-tracker/:userId', lineManagerController.getUserProgressView);

router.post('/linemanager/records-performance-tracker/:userId', lineManagerController.saveObjectiveSettings);
router.post('/linemanager/records-performance-tracker/questionnaire/:userId', lineManagerController.save360DegreeFeedback);

// router.get('/linemanager/records-performance-tracker/stepper/:quarter', lineManagerController.getQuarterStepper);



module.exports = router; 

