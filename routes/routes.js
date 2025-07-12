const express = require('express');
const router = express.Router();
const applicantController = require('../controllers/applicantController');
const staffLoginController = require('../controllers/staffloginController');
const hrController = require('../controllers/hrController');
const employeeController = require('../controllers/employeeController');
const lineManagerController = require('../controllers/lineManagerController');
const contactController = require('../controllers/contactUsController');
const fileUpload = require('express-fileupload');  // Make sure you've installed express-fileupload
const { hr } = require('date-fns/locale');
// Middleware to parse incoming request bodies
router.use(express.urlencoded({ extended: true }));
router.use(fileUpload());

const emailService = require('../utils/emailService');

// Route to render the public home page
router.get('/', applicantController.getAboutPage);
router.get('/applicant/signup', applicantController.getApplicantRegisterPage);
router.post('/applicant/signup', applicantController.handleRegisterPage);
router.post('/applicant/signup/checkemail', applicantController.handleLoginCheckEmail);
router.get('/applicant/login', applicantController.getApplicantLogin);
router.post('/applicant/login', applicantController.handleLoginSubmit);
router.get('/applicant/schedule-interview', applicantController.getCalendly);
router.post('/update-applicant-status', applicantController.updateApplicantStatus);
router.get('/applicant/logout', applicantController.getLogoutButton);

// Applicant 
router.get('/about', applicantController.getAboutPage);
router.get('/jobrecruitment', applicantController.getJobRecruitment);
router.get('/contactform', applicantController.getContactForm);
router.get('/contact', contactController.getContactForm);
router.post('/contact', contactController.contactValidationRules(), contactController.handleContactForm);
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
// File upload routes
router.post('/handleFileUpload', applicantController.handleFileUpload); // For initial 3 documents (degree, cert, resume)
router.post('/handleReuploadsFileUpload', applicantController.handleReuploadsFileUpload); // For HR-requested reuploads

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

router.get('/hr/useraccount', hrController.getUserAccount);
router.post('/hr/update-info', hrController.updateUserInfo);
router.get('/hr/persinfocareerprog', hrController.getPersInfoCareerProg); // copied this url since HR is an employee
router.post('/hr/update-persinfo', hrController.updatePersUserInfo);

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

router.get('/hr/recruitment/reports', hrController.getRecruitmentReports);
router.get('/hr/recruitment/dashboard/stats', hrController.getRecruitmentDashboardStats);
router.get('/hr/recruitment/dashboard/charts', hrController.getChartData);
router.get('/hr/recruitment/reports/applicants', hrController.getApplicantsReport);
router.get('/hr/recruitment/reports/hirees', hrController.getHireesReport);
router.get('/hr/recruitment/reports/applicant-status', hrController.getApplicantStatusReport);
router.get('/hr/recruitment/reports/timeline', hrController.getTimelineReport);
router.get('/hr/recruitment/reports/search-applicants', hrController.getSearchApplicants);
router.get('/hr/recruitment/reports/mrf-efficiency', hrController.getMRFEfficiencyReport);
router.get('/hr/recruitment/dashboard/funnel', hrController.getFunnelData);
router.get('/hr/recruitment/dashboard/time-to-hire', hrController.getTimeToHireData);
// Main recruitment reports page
router.get('/line-manager/recruitment/reports', lineManagerController.getRecruitmentReports);
router.get('/line-manager/recruitment/department-info', lineManagerController.getDepartmentInfo);
router.get('/line-manager/recruitment/dashboard/stats', lineManagerController.getDeptDashboardStats);
router.get('/line-manager/recruitment/dashboard/charts', lineManagerController.getDeptChartData);
router.get('/line-manager/recruitment/reports/applicants', lineManagerController.getDeptApplicantsReport);
router.get('/line-manager/recruitment/reports/hirees', lineManagerController.getDeptHireesReport);
router.get('/line-manager/recruitment/reports/applicant-status', lineManagerController.getDeptApplicantStatusReport);
router.get('/line-manager/recruitment/reports/mrf-performance', lineManagerController.getMRFPerformanceReport);
router.get('/line-manager/recruitment/reports/pipeline', lineManagerController.getDeptPipelineReport);
router.get('/line-manager/recruitment/reports/search-applicants', lineManagerController.getSearchDeptApplicants);
router.get('/line-manager/recruitment/dashboard/funnel', lineManagerController.getDeptFunnelData);
router.get('/line-manager/recruitment/dashboard/time-to-hire', lineManagerController.getDeptTimeToHireData);

router.get('/logout', hrController.getLogoutButton);
router.get('/logout', lineManagerController.getLogoutButton);

// Route for updating applicant status
// router.post('/update-applicant', hrController.updateApplicantIsChosen);
router.get('/evaluation-form/:applicantId', hrController.getEvaluationForm);
router.post('/saveEvaluation', hrController.saveEvaluation);

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
router.post('/employee/leaverequest/balances/update', employeeController.postLeaveBalancesByUserId); // To get leave balances
router.get('/employee/leaverequest/pending', employeeController.fetchPendingRequestsCount);
router.get('/employee/leaverequest/latest', employeeController.getLatestLeaveBalances);

router.get('/employee/viewtimeline', employeeController.getViewPerformanceTimeline);


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
router.get('/interview-form/:applicantId', lineManagerController.getInterviewForm);
router.get('/linemanager/view-interview-form/:applicantId', lineManagerController.getViewInterviewForm);
router.get('/linemanager/view-interview-form-by-userid/:userId', lineManagerController.getViewInterviewFormByUserId);

// automated email sending (individual email)
router.post('/linemanager/send-automated-email', lineManagerController.sendAutomatedEmail);
// bulk email sending (batch process)
router.post('/linemanager/send-bulk-emails', lineManagerController.sendBulkEmails);
// get email sending status
router.get('/linemanager/email-status/:batchId', lineManagerController.getEmailStatus);
// routes for P1 with email automation
router.post('/linemanager/applicant-tracker-jobposition/finalizeP1ReviewWithEmails', lineManagerController.finalizeP1ReviewWithEmails);
// routes for P3 with email automation  
router.post('/linemanager/applicant-tracker-jobposition/finalizeP3ReviewWithEmails', lineManagerController.finalizeP3ReviewWithEmails);
// Route to fetch user email (for job offer system)
router.get('/linemanager/get-user-email/:userId', lineManagerController.getUserEmail);


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

// get responserate
router.get('/linemanager/check-department-response-rate/:userId', lineManagerController.checkDepartmentResponseRate);

router.post('/linemanager/records-performance-tracker/questionnaire/:userId', lineManagerController.save360Questionnaire);
router.post('/linemanager/offboarding/update', lineManagerController.updateOffboardingRequest);

// router.get('/linemanager/records-performance-tracker/stepper/:quarter', lineManagerController.getQuarterStepper);

// notification Line Manager
router.get('/staff/managerdashboard', lineManagerController.getLineManagerNotifications);



// Routes for passing and rejecting applicants through web interface
router.get('/linemanager/passp3-applicant/:applicantId', lineManagerController.passP3Applicant);
router.get('/linemanager/rejectp3-applicant/:applicantId', lineManagerController.rejectP3Applicant);
router.post('/reject-applicant/:applicantId', lineManagerController.rejectApplicant); // For form submission with reason
router.post('/linemanager/applicant-tracker-jobposition/finalizeP3ReviewGmail', lineManagerController.finalizeP3ReviewGmail);
router.get('/linemanager/applicant-tracker-jobposition/getP3EmailTemplates', lineManagerController.getP3EmailTemplates);
router.post('/linemanager/applicant-tracker-jobposition/updateP3Statuses', lineManagerController.updateP3Statuses);
router.get('/linemanager/get-p3-assessment/:userId', lineManagerController.getP3Assessment);

/* ORDER OF ATS CODES  */ 

router.get('/hr/applicant-tracker', hrController.getApplicantTrackerAllJobPositions);
router.get('/hr/applicant-tracker-jobposition', hrController.getApplicantTrackerByJobPositions);
router.get('/get-applicant-assessment/:userId', hrController.getApplicantAssessment);
router.post('/hr/applicant-tracker-jobposition/P1AwaitingforLineManager', hrController.updateStatusToP1AwaitingforLineManager);
router.get('/hr/view-final-results/:userId', hrController.getFinalResults);
router.post('/handleFileUpload', applicantController.handleReuploadsFileUpload);

router.post('/hr/request-document-reupload', hrController.requestDocumentReupload);
router.get('/hr/get-additional-document/:userId', hrController.getAdditionalDocument);

router.get('/linemanager/applicant-tracker', lineManagerController.getApplicantTracker);
router.get('/linemanager/applicant-tracker-jobposition', lineManagerController.getApplicantTrackerByJobPositions);


// Routes for P1 review management
router.get('/linemanager/get-assessment/:userId', lineManagerController.getApplicantAssessment);
router.post('/linemanager/applicant-tracker-jobposition/finalizeP1Review', lineManagerController.finalizeP1Review);
router.post('/linemanager/applicant-tracker-jobposition/updateP1Statuses', lineManagerController.updateP1Statuses); 
router.post('/linemanager/applicant-tracker-jobposition/markAsP1Passed',  lineManagerController.markAsP1Passed);
router.post('/linemanager/applicant-tracker-jobposition/markAsP1Failed',  lineManagerController.markAsP1Failed);
// Email functionality routes
router.get('/linemanager/applicant-tracker-jobposition/getEmailTemplates', lineManagerController.getEmailTemplates);
router.post('/linemanager/applicant-tracker-jobposition/updateP1Statuses', lineManagerController.updateP1Statuses);


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
router.post('/hr/send-automated-email', hrController.sendAutomatedEmail);
router.get('/getEmailTemplates', hrController.getEmailTemplates);

// Routes for P3 review management
router.post('/linemanager/applicant-tracker-jobposition/finalizeP3Review', lineManagerController.finalizeP3Review);
router.post('/linemanager/applicant-tracker-jobposition/markAsP3Passed',  lineManagerController.markAsP3Passed);
router.post('/linemanager/applicant-tracker-jobposition/markAsP3Failed', lineManagerController.markAsP3Failed);


router.get('/hr/get-applicant-onboarding-data/:userId', hrController.getApplicantOnboardingData);

// Notification routes
router.get('/api/employee/notifications', employeeController.getEmployeeNotifications);
router.get('/employee/api/get360Feedback', employeeController.get360FeedbackToast);

router.get('/employee/staffFeedbackList', employeeController.staffFeedbackList);
router.get('/employee/api/getQuestionnaireData', employeeController.getQuestionnaireData);
router.post('/employee/api/submitFeedback', employeeController.submitFeedback);
router.get('/employee/api/checkFeedbackStatus', employeeController.checkFeedbackStatus);
router.get('/employee/api/getAvailableFeedbackPeriods', employeeController.getAvailableFeedbackPeriods);

router.get('/api/linemanager/notifications', lineManagerController.getLineManagerNotifications);
router.get('/api/get360FeedbackToast', lineManagerController.get360FeedbackToast);
router.get('/linemanager/api/get360Feedback', lineManagerController.get360FeedbackToast);
router.get('/linemanager/staffFeedbackList', lineManagerController.staffFeedbackList);
router.get('/linemanager/api/checkFeedbackStatus', lineManagerController.checkFeedbackStatus);
router.get('/linemanager/api/getQuestionnaireData', lineManagerController.getQuestionnaireData);
router.post('/linemanager/api/submitFeedback', lineManagerController.submitFeedback);
router.get('/linemanager/api/getAvailableFeedbackPeriods', lineManagerController.getAvailableFeedbackPeriods);


router.use((error, req, res, next) => {
    console.error('Route error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            success: false,
            message: 'File too large'
        });
    }
    return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});
// Mid-year IDP routes
router.get('/linemanager/quarterly-feedback-report/:userId', lineManagerController.generateQuarterlyFeedbackReport);
// Alternative route format 2
router.get('/api/reports/quarterly-feedback/:userId', 
    lineManagerController.generateQuarterlyFeedbackReport
);


router.get('/linemanager/midyear-idp/:userId', lineManagerController.getMidYearIDP);
router.post('/linemanager/midyear-idp/:userId', lineManagerController.saveMidYearIDP);
router.get('/linemanager/midyear-idp-trainings/:userId', lineManagerController.getMidYearIDPWithTrainings);
router.get('/midyear-idp-view/:userId', lineManagerController.getMidYearIDPViewData);
router.get('/linemanager/training-categories/:userId', lineManagerController.getTrainingCategories);
router.post('/linemanager/training-categories', lineManagerController.addTrainingCategory);

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
router.get('/linemanager/finalyear-idp-trainings/:userId', lineManagerController.getFinalYearIDPWithTrainings);
router.get('/linemanager/midyear-feedback-aggregates/:userId', lineManagerController.getMidYearFeedbackAggregates);
router.get('/linemanager/finalyear-feedback-aggregates/:userId', lineManagerController.getFinalYearFeedbackAggregates);
router.get('/linemanager/debug-finalyear-aggregates/:userId', lineManagerController.debugFinalYearAggregates);

router.get('/linemanager/get-feedback-data/:userId', lineManagerController.getFeedbackData);
// In your routes file

// Add this to your routes file (routes.js or similar)
router.get('/linemanager/check-feedback-status', lineManagerController.checkFeedbackStatus);


// ============================
// Line Manager - TRAINING MODULE CONTROLLER FUNCTIONS
// ============================
router.get('/linemanager/training-form-data', lineManagerController.getTrainingFormData);
// router.post('/linemanager/training', lineManagerController.createTraining);
// router.post('/linemanager/activity-type', lineManagerController.addActivityType);
// router.get('/linemanager/trainings', lineManagerController.getAllTrainings);
router.get('/linemanager/training-development-tracker', lineManagerController.getTrainingDevelopmentTracker);
// Training request routes
router.get('/linemanager/training-request/:userId', lineManagerController.getTrainingRequest);
router.get('/linemanager/api/training-request/:userId/details', lineManagerController.getTrainingRequestDetails); // Fixed path
// router.post('/linemanager/training/approve', lineManagerController.approveTrainingRequest); // Fixed path
// router.post('/linemanager/training/reject', lineManagerController.rejectTrainingRequest); // Fixed path
router.post('/api/training/endorse', lineManagerController.endorseTrainingToHR);
router.post('/api/training/reject', lineManagerController.cancelTraining);
router.get('/api/training/details/:id', lineManagerController.getTrainingDetailsAPI);
// GET /api/employee/trainings/:userId
router.get('/linemanager/api/employee/trainings/:userId', lineManagerController.getEmployeeTrainingHistory);
// Add this route to your routes file
router.get('/linemanager/api/employee/progress/:userId', lineManagerController.getEmployeeProgressForLineManagerRoute);
// Add this route with your other linemanager API routes
router.get('/linemanager/api/training/details/:trainingRecordId', lineManagerController.getTrainingDetails);
router.get('/linemanager/api/training-needs-report', lineManagerController.getEmployeeTrainingNeedsReport);
router.get('/linemanager/api/performance-improvement-report', lineManagerController.getPerformanceImprovementReport);
router.get('/linemanager/api/training-summary-report', lineManagerController.getTrainingSummaryReport);

// Alternative: If you want to include it in your existing training routes
// GET /api/training/employee/:userId
// router.get('/training/employee/:userId', lineManagerController.getEmployeeTrainingHistory);

// Make sure your existing routes are also present:
// router.post('/training/endorse', TrainingController.endorseTraining);
// router.post('/training/reject', TrainingController.rejectTraining);
// router.get('/training/details/:trainingRecordId', lineManagerController.getTrainingDetails);

// NEW: Pending training requests management routes (ADD THESE 4 LINES)
// router.post('/linemanager/training-request/approve', lineManagerController.approveTrainingRequestByRecord);
// router.post('/linemanager/training-request/reject', lineManagerController.rejectTrainingRequestByRecord);
// router.post('/linemanager/training-request/approve-bulk', lineManagerController.approveTrainingRequestsBulk);
// router.post('/linemanager/training-request/reject-bulk', lineManagerController.rejectTrainingRequestsBulk);

// // Add this line with your other training routes
// router.get('/linemanager/training/:trainingId/objectives', lineManagerController.getTrainingObjectives);
// // Add this line with your other training routes
// router.get('/linemanager/training/:trainingId/skills', lineManagerController.getTrainingSkills);

// ============================
// Employee - TRAINING MODULE CONTROLLER FUNCTIONS
// ============================
// Core training pages
router.get('/employee/training/home', employeeController.getEmployeeTrainingHome);
router.get('/employee/training/course/:trainingRecordId', employeeController.getEmployeeTrainingSpecific);

// FIXED: Training progress and records - removed duplicates and added missing endpoint
router.get('/employee/training-progress', employeeController.getEmployeeTrainingProgress); // Frontend expects this
router.get('/employee/training-records', employeeController.getEmployeeAllCourses); // For all courses tab
router.get('/employee/training/:trainingRecordId/details', employeeController.getTrainingRecordDetails);

// IDP Management
router.get('/employee/idp-periods', employeeController.getIdpPeriods);
router.get('/employee/idp/midyear/:idpId', employeeController.getMidYearIDPForEmployee);
router.get('/employee/idp/final/:idpId', employeeController.getFinalYearIDPForEmployee);
router.get('/employee/idp/:idpId/categories', employeeController.getIdpCategories);

// User context data
router.get('/employee/user-objectives', employeeController.getUserObjectives);
router.get('/employee/user-skills', employeeController.getUserSkills);
router.get('/employee/user-job-info', employeeController.getUserJobInfo);

// Training request creation
router.post('/employee/create-new-training-request', employeeController.createNewTrainingRequest);
// Training time estimation and scheduling
// router.get('/employee/training/time-estimation', employeeController.getTrainingTimeEstimation);
// router.post('/employee/training/calculate-schedule', employeeController.calculateTrainingSchedule);
// REMOVED: Old training dropdown - not needed with new structure
// router.get('/employee/trainings/dropdown', employeeController.getTrainingDropdown);
// router.get('/employee/trainings/:trainingId/details', employeeController.getTrainingDetails);

// Activity Types Management
router.get('/employee/activity-types', employeeController.getActivityTypes);
router.post('/employee/activity-types', employeeController.addActivityType);

// Activity updates
router.put('/employee/training/:trainingRecordId/activity/:activityId', employeeController.updateSingleActivity);
router.put('/employee/training/:trainingRecordId/activities', employeeController.updateTrainingActivities);

// Certificates
router.get('/employee/certificates', employeeController.getEmployeeCertificates);
router.get('/employee/training/:trainingRecordId/certificates', employeeController.getCertificatesForTraining);
router.post('/employee/certificates/upload', employeeController.uploadTrainingCertificate);

// Helper functions
router.get('/employee/user-job-info', employeeController.getUserJobInfo);
// router.get('/employee/training-progress', employeeController.getTrainingProgress);
// router.get('/employee/all-courses', employeeController.getAllCourses);
router.get('/employee/training/:trainingRecordId/certificates', employeeController.getCertificatesForTraining);
// router.get('/employee/training-records', employeeController.getAllTrainingRecords);
// router.get('/employee/certificates', employeeController.getCertificates);

// router.get('/employee/:certId/download', employeeController.downloadCertificate);

// ============================
// HR - TRAINING MODULE CONTROLLER FUNCTIONS
// ============================
router.get('/hr/training-development-tracker', hrController.getHrTrainingDevelopmentTracker);
router.get('/hr/pending-training-requests', hrController.getPendingTrainingRequests);
router.post('/hr/approve-training-request', hrController.approveTrainingRequest);
router.get('/hr/budget-overview', hrController.getBudgetOverview);
router.post('/hr/update-budget', hrController.updateBudget);
router.get('/hr/training-approval-history', hrController.getTrainingApprovalHistory);
router.get('/hr/training-analytics', hrController.getTrainingAnalytics);
router.get('/hr/training-efficiency', hrController.getTrainingEfficiency);

// commenting this out for now
// router.get('/hr/employees', hrController.getEmployees);
// router.get('/hr/training-form-data', hrController.getTrainingFormData); 
// router.post('/hr/training', hrController.createTraining); 
// router.get('/hr/employees/filter', hrController.getEmployeesByFilter); 
// router.get('/hr/existing-trainings', hrController.getExistingTrainings); 
// router.post('/hr/training/reassign', hrController.reassignTraining); 
// router.get('/hr/training/:trainingId/details', hrController.getTrainingDetails);
// router.get('/hr/employee-dashboard', hrController.getEmployeeTrainingDashboard);
// router.get('/hr/training-reports/courses', hrController.getTrainingCoursesReport);
// router.get('/hr/training-reports/assignments', hrController.getTrainingAssignmentsReport);
// router.get('/hr/training-reports/assignments/filtered', hrController.getFilteredTrainingAssignments);
// router.get('/hr/budget-report', hrController.getBudgetReport);
// router.get('/hr/budget-export/:format', hrController.exportBudgetReport);


router.get('/hr/offboarding-dashboard-stats', hrController.getOffboardingDashboardStats);
router.get('/hr/offboarding-reports', hrController.getOffboardingReports);
router.get('/linemanager/offboarding-dashboard-stats', lineManagerController.getOffboardingDashboardStats);
router.get('/linemanager/offboarding-reports', lineManagerController.getOffboardingReports);


router.get('/hr/reports/employees', hrController.getEmployeesForReports);
router.get('/hr/reports/daily-attendance', hrController.getDailyAttendanceReport);
router.get('/hr/reports/employee-attendance', hrController.getEmployeeAttendanceReport);
router.get('/hr/reports/leave-requests', hrController.getLeaveRequestsReport);
router.get('/linemanager/reports/employees', lineManagerController.getDepartmentEmployeesForReports);
router.get('/linemanager/reports/daily-attendance', lineManagerController.getDepartmentDailyAttendanceReport);
router.get('/linemanager/reports/employee-attendance', lineManagerController.getDepartmentEmployeeAttendanceReport);
router.get('/linemanager/reports/leave-requests', lineManagerController.getDepartmentLeaveRequestsReport);


// ============================
// 360 FEEDBACK REPORTS MODULE - ROUTES
// ============================

router.get('/linemanager/reports/feedback-dashboard', lineManagerController.getQuarterlyFeedbackReportsDashboard);
router.get('/linemanager/reports/feedback-employees', lineManagerController.getDepartmentEmployeesForFeedbackReports);
router.get('/linemanager/reports/quarterly-feedback', lineManagerController.generateQuarterlyFeedbackReport);
router.get('/linemanager/reports/mid-year-feedback', lineManagerController.getMidYearFeedbackReport);
router.get('/linemanager/reports/final-year-feedback', lineManagerController.getFinalYearFeedbackReport);
router.get('/linemanager/reports/comparison-feedback', lineManagerController.getComparisonFeedbackReport);
router.get('/hr/reports/company-wide-employees', hrController.getCompanyWideEmployeesForFeedbackReports);
router.get('/hr/reports/quarterly-feedback', hrController.generateQuarterlyFeedbackReport);
router.get('/hr/reports/mid-year-feedback', hrController.getMidYearFeedbackReport);
router.get('/hr/reports/final-year-feedback', hrController.getFinalYearFeedbackReport);
router.get('/hr/reports/comparison-feedback', hrController.getComparisonFeedbackReport);
module.exports = router; 

