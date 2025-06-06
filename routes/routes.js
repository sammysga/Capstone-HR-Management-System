const express = require('express');
const router = express.Router();
const applicantController = require('../controllers/applicantController');
const staffLoginController = require('../controllers/staffloginController');
const hrController = require('../controllers/hrController');
const employeeController = require('../controllers/employeeController');
const lineManagerController = require('../controllers/lineManagerController');
const fileUpload = require('express-fileupload');  // Make sure you've installed express-fileupload
const { hr } = require('date-fns/locale');
// Middleware to parse incoming request bodies
router.use(express.urlencoded({ extended: true }));
router.use(fileUpload());


// Route to render the public home page
router.get('/', applicantController.getAboutPage);
router.get('/applicant/signup', applicantController.getApplicantRegisterPage);
router.post('/applicant/signup', applicantController.handleRegisterPage);
router.get('/applicant/login', applicantController.getApplicantLogin);
router.post('/applicant/login', applicantController.handleLoginSubmit);
router.get('/applicant/schedule-interview', applicantController.getCalendly);
router.post('/update-applicant-status', applicantController.updateApplicantStatus);

// Applicant 
router.get('/about', applicantController.getAboutPage);
router.get('/jobrecruitment', applicantController.getJobRecruitment);
router.get('/contactform', applicantController.getContactForm);
router.get('/job-details/:jobId', applicantController.getJobDetailsTitle);
// router.get('/chatbothome', applicantController.getChatbotPage);
//router.get('/employeechatbothome', applicantController.getInternalApplicantChatbotPage);
// router.get('/applicant/onboarding', applicantController.getOnboarding);
// router.post('/applicant/onboarding', applicantController.postOnboarding);
router.get('/applicant/onboarding/employee-records', applicantController.getOnboardingEmployeeRecords);
router.get('/applicant/onboarding/osd-wait', applicantController.getOnboardingWaitOSD);
router.get('/applicant/onboarding/objective-setting-view', applicantController.getOnboardingObjectiveSetting);

router.get('/applicant/job-offer', applicantController.getJobOffer);
router.post('/api/accept-job-offer', applicantController.acceptJobOffer);
router.get('/applicant/onboarding', applicantController.getApplicantOnboarding);
router.post('/onboarding/update-status', applicantController.updateApplicantStatus);

router.get('/applicant/awaiting-account-setup', function(req, res) {
    // Render the awaiting account setup page
    res.render('applicant_pages/awaitingaccountsetup');
});

// Chatbot routes
router.get('/chatbothome', applicantController.getChatbotPage);
router.post('/chatbothome', applicantController.handleChatbotMessage);
router.post('/handleFileUpload', applicantController.handleFileUpload); // Directly use the controller method for file handling

// Staff Log in
router.get('/staff/login', staffLoginController.getStaffLogin);
router.post('/staff/login', staffLoginController.postStaffLogin);

// Notification Functions
router.get('/employee/api/get360FeedbackNotification', employeeController.getNotificationSection_360DegreeFeedback);

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
router.post('/hr/reject-applicant', hrController.rejectApplicant);
router.post('/hr/pass-applicant', hrController.passApplicant);
router.get('/hr/view-evaluation/:applicantId', hrController.viewEvaluation);
// Mark applicant as P2 PASSED (pending finalization)
router.post('/hr/markAsP2Passed', hrController.markAsP2Passed);
// Mark applicant as P2 FAILED (pending finalization)
router.post('/hr/markAsP2Failed', hrController.markAsP2Failed);
// Finalize P2 review and notify all applicants
router.post('/hr/finalizeP2Review', hrController.finalizeP2Review);
router.get('/hr/getP2EmailTemplates', hrController.getP2EmailTemplates);
router.get('/getEmailTemplates', hrController.getEmailTemplates);

router.get('/hr/useraccount', hrController.getUserAccount);
router.post('/hr/update-info', hrController.updateUserInfo);
router.get('/employee/persinfocareerprog', hrController.getPersInfoCareerProg); // copied this url since HR is an employee
router.post('/employee/update-persinfo', hrController.updatePersUserInfo);
// Career Progression, Degree, Experience, and Certifications routes
router.post('/employee/employeepersinfocareerprog/editcareerprogression', employeeController.editCareerProgression);
router.post('/employee/employeepersinfocareerprog/editdegreeinfo', employeeController.editDegreeInformation);
router.post('/employee/employeepersinfocareerprog/editexperience', employeeController.editExperiences);
router.post('/employee/employeepersinfocareerprog/editcertification', employeeController.editCertifications);

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

// router.post('/notify-line-manager', hrController.postNotifyLineManager);
// Backend route to handle evaluation form page
router.get('/hr/evaluation-form/:applicantId', hrController.getEvaluationForm);
router.get('/api/hr/notifications', hrController.getHRNotifications);

router.post('/hr/send-onboarding-checklist', hrController.sendOnboardingChecklist);
router.get('/hr/get-start-date', hrController.getOnboardingStartDate);
router.get('/hr/onboarding-view', hrController.getHROnboarding);
router.get('/hr/offboarding-request', hrController.getOffboardingRequestsDash);
router.get('/hr/view-offboarding-request/:userId', hrController.getViewOffboardingRequest);
router.get('/get-contact-persons', hrController.getContactPersons);
router.post('/save-clearance', hrController.saveChecklist);
router.post('/send-clearance', hrController.sendClearanceToEmployee);
router.get('/hr/retirement-tracker', hrController.getRetirementTracker);
router.post('/hr/approve-offboarding', hrController.approveOffboarding);
router.post('/hr/applicant-tracker-jobposition/P1HRFailed', hrController.updateStatusToP1HRFailed);

router.get('/logout', hrController.getLogoutButton);
router.get('/logout', lineManagerController.getLogoutButton);

// Route for updating applicant status
router.post('/update-applicant', hrController.updateApplicantIsChosen);
router.get('/evaluation-form/:applicantId', hrController.getEvaluationForm);
router.post("/saveEvaluation", hrController.saveEvaluation);

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
router.post('/employee/cancel-offboarding', employeeController.cancelOffboardingRequest);
router.get('/employee/get-clearance-items/:requestId', employeeController.getClearanceItems);
router.post('/employee/submit-clearance', employeeController.submitEmployeeClearance);



router.get('/employee/leaverequest', employeeController.getLeaveRequestForm); // To load the form
router.post('/employee/leaverequest', employeeController.submitLeaveRequest); // To submit a leave request
router.get('/employee/leaverequest/requests', employeeController.getLeaveRequestsByUserId); // To get leave requests
router.post('/employee/leaverequest', employeeController.postLeaveBalancesByUserId); // To get leave balances
router.get('/employee/leaverequest/pending', employeeController.fetchPendingRequestsCount);
router.get('/employee/leaverequest/latest', employeeController.getLatestLeaveBalances);

router.get('/employee/viewtimeline', employeeController.getViewPerformanceTimeline);

// Employee Training Routes
router.get('/employee/training/home', employeeController.getEmployeeTrainingHome);
router.get('/employee/training/course', employeeController.getEmployeeTrainingSpecific);


router.get('/employee/attendance', employeeController.getAttendance);
router.post('/employee/attendance', employeeController.postAttendance);
// router.get('/employee/api/get360Feedback', employeeController.get360FeedbackToast);
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
router.post('/linemanager/approve-line-manager', lineManagerController.postApproveLineManager); // Approve Line Manager Action

// New route to notify Line Manager
//router.post('/linemanager/notify', lineManagerController.notifyLineManager);

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

// POST route to handle form submission
router.post('/submit-interview-evaluation/:applicantId', lineManagerController.submitInterviewEvaluation);
router.get('/applicant/:applicantId', lineManagerController.getApplicantDetails);

// Route to view the completed interview form
router.get('/view-interview-form/:applicantId', lineManagerController.getViewInterviewForm);

// Routes for passing and rejecting applicants through web interface
router.get('/pass-applicant/:applicantId', lineManagerController.passApplicant);
router.get('/reject-applicant/:applicantId', lineManagerController.rejectApplicant);
router.post('/reject-applicant/:applicantId', lineManagerController.rejectApplicant); // For form submission with reason

// API routes for handling pass/reject actions from main applicant list
router.post('/handle-pass-applicant', lineManagerController.handlePassApplicant);
router.post('/handle-reject-applicant', lineManagerController.handleRejectApplicant);
// Approve an applicant
router.post('/approve-applicant', lineManagerController.approveApplicant);

// Reject an applicant
router.post('/reject-applicant', lineManagerController.rejectApplicant);


// Route to handle job offer sending
router.post('/linemanager/send-job-offer', lineManagerController.sendJobOffer);


// Route to view job offer details
router.get('/linemanager/job-offer-details/:jobOfferId', lineManagerController.getJobOfferDetails);

// Route to get the job offer modal HTML fragment (optional)
router.get('/fragment/job-offer-modal', (req, res) => {
    res.render('partials/job-offer-modal');
});



router.get('/linemanager/offboarding-requests', lineManagerController.getOffboardingRequestsDash);
router.get('/linemanager/view-offboarding-request/:userId', lineManagerController.getViewOffboardingRequest);
router.get('/linemanager/final-result', lineManagerController.getFinalResult);
router.get('/linemanager/approved-final-result', lineManagerController.getApprovedFinalResult);
router.get('/linemanager/rejected-final-result', lineManagerController.getRejectedFinalResult);
router.get('/linemanager/interview-form-line', lineManagerController.getInterviewFormLinemanager);
router.get('/linemanager/first-objective-setting', lineManagerController.getFirstDayObjectiveSetting);

// Route for viewing an employee's performance tracker with a quarter
// router.get('/linemanager/records-performance-tracker/:userId/:quarter',
//     lineManagerController.fetchFeedbackData,
//     lineManagerController.getUserProgressView);
router.get('/linemanager/records-performance-tracker/:userId', lineManagerController.getUserProgressView);

router.post('/linemanager/records-performance-tracker/:userId', lineManagerController.saveObjectiveSettings);
// Route to get feedback questionnaire data
router.get('/linemanager/get-feedback-questionnaire/:userId', lineManagerController.getFeedbackQuestionnaire);
// Route for saving feedback questionnaire
router.post('/linemanager/save-feedback-questionnaire/:userId', lineManagerController.save360Questionnaire);


router.post('/linemanager/records-performance-tracker/questionnaire/:userId', lineManagerController.save360Questionnaire);
router.post('/linemanager/offboarding/update', lineManagerController.updateOffboardingRequest);

// router.get('/linemanager/records-performance-tracker/stepper/:quarter', lineManagerController.getQuarterStepper);

// notification Line Manager
router.get('/staff/managerdashboard', lineManagerController.getLineManagerNotifications);



/* ORDER OF ATS CODES  */ 
router.get('/hr/applicant-tracker', hrController.getApplicantTrackerAllJobPositions);
router.get('/hr/applicant-tracker-jobposition', hrController.getApplicantTrackerByJobPositions);
router.post('/hr/applicant-tracker-jobposition/P1AwaitingforLineManager', hrController.updateStatusToP1AwaitingforLineManager);
router.get('/hr/view-final-results/:userId', hrController.getFinalResults);

router.get('/linemanager/applicant-tracker', lineManagerController.getApplicantTracker);
router.get('/linemanager/applicant-tracker-jobposition', lineManagerController.getApplicantTrackerByJobPositions);

// Routes for P1 review management
router.post('/linemanager/applicant-tracker-jobposition/finalizeP1Review', lineManagerController.finalizeP1Review);
router.post('/linemanager/applicant-tracker-jobposition/updateP1Statuses', lineManagerController.updateP1Statuses); 
router.post('/linemanager/applicant-tracker-jobposition/markAsP1Passed',  lineManagerController.markAsP1Passed);
router.post('/linemanager/applicant-tracker-jobposition/markAsP1Failed',  lineManagerController.markAsP1Failed);
// Email functionality routes
router.get('/linemanager/applicant-tracker-jobposition/getEmailTemplates', lineManagerController.getEmailTemplates);
router.post('/linemanager/applicant-tracker-jobposition/updateP1Statuses', lineManagerController.updateP1Statuses);
// Routes for P3 review management
router.post('/linemanager/applicant-tracker-jobposition/finalizeP3Review', lineManagerController.finalizeP3Review);
router.post('/linemanager/applicant-tracker-jobposition/markAsP3Passed',  lineManagerController.markAsP3Passed);
router.post('/linemanager/applicant-tracker-jobposition/markAsP3Failed', lineManagerController.markAsP3Failed);

// Notification routes
router.get('/api/employee/notifications', employeeController.getEmployeeNotifications);
router.get('/employee/api/get360Feedback', employeeController.get360FeedbackToast);

router.get('/employee/staffFeedbackList', employeeController.staffFeedbackList);
router.get('/employee/api/getQuestionnaireData', employeeController.getQuestionnaireData);
router.post('/employee/api/submitFeedback', employeeController.submitFeedback);
router.get('/employee/api/checkFeedbackStatus', employeeController.checkFeedbackStatus);

router.get('/api/linemanager/notifications', lineManagerController.getLineManagerNotifications);
router.get('/api/get360FeedbackToast', lineManagerController.get360FeedbackToast);
router.get('/linemanager/api/get360Feedback', lineManagerController.get360FeedbackToast);
router.get('/linemanager/staffFeedbackList', lineManagerController.staffFeedbackList);
router.get('/linemanager/api/checkFeedbackStatus', lineManagerController.checkFeedbackStatus);
router.get('/linemanager/api/getQuestionnaireData', lineManagerController.getQuestionnaireData);
router.post('/linemanager/api/submitFeedback', lineManagerController.submitFeedback);



// Mid-year IDP routes
router.get('/linemanager/midyear-idp/:userId', lineManagerController.getMidYearIDP);
router.post('/linemanager/midyear-idp/:userId', lineManagerController.saveMidYearIDP);
// Route for getting Mid-Year feedback aggregates
router.get('/linemanager/midyear-feedback-aggregates/:userId', 
    lineManagerController.getRecordsPerformanceTrackerByUserId,
    lineManagerController.getMidYearFeedbackAggregates
);
// Alternative route structure if you prefer to include it in the main records route
router.get('/linemanager/records-performance-tracker/:userId/midyear-aggregates', lineManagerController.getRecordsPerformanceTrackerByUserId,
    lineManagerController.getMidYearFeedbackAggregates
);

// Final-year IDP routes
router.get('/linemanager/finalyear-idp/:userId', lineManagerController.getFinalYearIDP);
router.post('/linemanager/finalyear-idp/:userId', lineManagerController.saveFinalYearIDP);

router.get('/linemanager/get-feedback-data/:userId', lineManagerController.getFeedbackData);
// In your routes file

// Add this to your routes file (routes.js or similar)
router.get('/linemanager/check-feedback-status', lineManagerController.checkFeedbackStatus);


module.exports = router; 

