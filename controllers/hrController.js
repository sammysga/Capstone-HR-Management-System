const { render } = require('ejs');
const supabase = require('../public/config/supabaseClient');
require('dotenv').config(); // To load environment variables
const bcrypt = require('bcrypt');
const { parse } = require('dotenv');
const flash = require('connect-flash/lib/flash');
const { getUserAccount, getPersInfoCareerProg } = require('./employeeController');
const applicantController = require('../controllers/applicantController');
const { check } = require('express-validator');


const hrController = {
    getHRDashboard: async function(req, res) {
        if (!req.session.user) {
            req.flash('errors', { authError: 'Unauthorized. Access only for authorized users.' });
            return res.redirect('/staff/login');
        }
    
        try {
            // Function to fetch and format manpower requisition forms
            const fetchAndFormatMRFData = async () => {
                const { data: mrfList, error: mrfError } = await supabase
                    .from('mrf')
                    .select('positionTitle, requisitionDate, mrfId, departmentId, status');

                if (mrfError) throw mrfError;

                // Fetch approval statuses
                const { data: approvals, error: approvalError } = await supabase
                    .from('mrf_approvals')
                    .select('mrfId, approval_stage, reviewerName')
                    .order('reviewerDateSigned', { ascending: true });

                if (approvalError) throw approvalError;

                // Fetch departments
                const { data: departments, error: deptError } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
                
                if (deptError) throw deptError;

                const combinedData = mrfList.map(mrf => {
                    const latestApproval = approvals.find(a => a.mrfId === mrf.mrfId);
                    const department = departments.find(d => d.departmentId === mrf.departmentId)?.deptName || 'N/A';
                
                    const requisitionerName = latestApproval ? latestApproval.reviewerName : 'Pending';
                
                    let status = mrf.status || 'Pending'; // default to pending

                    const buttonText = (status === 'Pending') ? 'Action Required' : '';

                    return {
                        requisitioner: requisitionerName,
                        department: department,
                        jobPosition: mrf.positionTitle,
                        requestDate: new Date(mrf.requisitionDate).toISOString().split('T')[0],
                        status: status,  
                        mrfId: mrf.mrfId,
                        actionButtonText: buttonText 
                    };
                });                

                return combinedData;
            };

            // Common function to fetch and format leave data
            const fetchAndFormatLeaves = async (statusFilter = null) => {
                const query = supabase
                    .from('leaverequests')
                    .select(`
                        leaveRequestId, 
                        userId, 
                        created_at, 
                        leaveTypeId, 
                        fromDate, 
                        untilDate, 
                        status,
                        useraccounts (
                            userId, 
                            userEmail,
                            staffaccounts (
                                departments (deptName), 
                                lastName, 
                                firstName
                            )
                        ), 
                        leave_types (
                            typeName
                        )
                    `)
                    .order('created_at', { ascending: false });
                
                if (statusFilter) query.eq('status', statusFilter);
                
                const { data, error } = await query;
                if (error) throw error;
                
                return data.map(leave => ({
                    lastName: leave.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
                    firstName: leave.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
                    department: leave.useraccounts?.staffaccounts[0]?.departments?.deptName || 'N/A',
                    filedDate: leave.created_at ? new Date(leave.created_at).toISOString().split('T')[0] : 'N/A',
                    type: leave.leave_types?.typeName || 'N/A',
                    startDate: leave.fromDate || 'N/A',
                    endDate: leave.untilDate || 'N/A',
                    status: leave.status || 'Pending'
                }));
            };
    
            // Function to fetch attendance logs with department filter
            const fetchAttendanceLogs = async () => {
                const { data: attendanceLogs, error: attendanceError } = await supabase
                    .from('attendance')
                    .select(`
                        userId, 
                        attendanceDate, 
                        attendanceAction, 
                        attendanceTime,
                        city, 
                        useraccounts (
                            userId, 
                            staffaccounts (
                                staffId,
                                firstName, 
                                lastName,
                                departmentId, 
                                jobId,
                                departments: departmentId ("deptName"),
                                jobpositions: jobId ("jobTitle")
                            )
                        )
                    `)
                    .order('attendanceDate', { ascending: false });
    
                if (attendanceError) {
                    console.error('Error fetching attendance logs:', attendanceError);
                    throw new Error('Error fetching attendance logs.');
                }
    
                return attendanceLogs;
            };
    
          // Function to format attendance logs
          const formatAttendanceLogs = (attendanceLogs, selectedDate = null) => {
            // Use the selected date or default to the current date
            const filterDate = selectedDate || new Date().toISOString().split('T')[0];
        
            const formattedAttendanceLogs = attendanceLogs
                .filter(attendance => attendance.attendanceDate === filterDate) // Filter logs by the selected or current date
                .reduce((acc, attendance) => {
                    const attendanceDate = attendance.attendanceDate;
                    const attendanceTime = attendance.attendanceTime || '00:00:00';
                    const [hours, minutes, seconds] = attendanceTime.split(':').map(Number);
                    const localDate = new Date(attendanceDate);
                    localDate.setHours(hours, minutes, seconds);
        
                    const userId = attendance.userId;
                    const existingEntry = acc.find(log => log.userId === userId && log.date === attendanceDate);
                    const city = attendance.city || 'N/A'
        
                    if (attendance.attendanceAction === 'Time In') {
                        if (existingEntry) {
                            existingEntry.timeIn = localDate;
                        } else {
                            acc.push({
                                userId,
                                date: attendanceDate,
                                timeIn: localDate,
                                timeOut: null,
                                city,
                                useraccounts: attendance.useraccounts
                            });
                        }
                    } else if (attendance.attendanceAction === 'Time Out') {
                        if (existingEntry) {
                            existingEntry.timeOut = localDate;
                        } else {
                            acc.push({
                                userId,
                                date: attendanceDate,
                                timeIn: null,
                                timeOut: localDate,
                                city,
                                useraccounts: attendance.useraccounts
                            });
                        }
                    }
        
                    return acc;
                }, []);
        
            return formattedAttendanceLogs.map(log => {
                let activeWorkingHours = 0;
                let timeOutMessage = '';
                const now = new Date();
        
                if (log.timeIn) {
                    const endOfDay = new Date(log.date);
                    endOfDay.setHours(23, 59, 59, 999); // End of the day
                    const endTime = log.timeOut || now;
        
                    if (!log.timeOut && endTime <= endOfDay) {
                        timeOutMessage = `(In Work)`;
                        activeWorkingHours = (endTime - log.timeIn) / 3600000; // Calculate hours
                    } else if (!log.timeOut && endTime > endOfDay) {
                        timeOutMessage = `(User did not Record Time Out)`;
                        activeWorkingHours = (endOfDay - log.timeIn) / 3600000; // Up to end of day
                    } else {
                        activeWorkingHours = (log.timeOut - log.timeIn) / 3600000; // Normal calculation
                    }
                }
        
                return {
                    department: log.useraccounts?.staffaccounts[0]?.departments?.deptName || 'N/A',
                    firstName: log.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
                    lastName: log.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
                    jobTitle: log.useraccounts?.staffaccounts[0]?.jobpositions?.jobTitle || 'N/A',
                    date: log.timeIn ? new Date(log.timeIn).toISOString().split('T')[0] : 'N/A',
                    timeIn: log.timeIn ? log.timeIn.toLocaleTimeString() : 'N/A',
                    timeOut: log.timeOut ? log.timeOut.toLocaleTimeString() : timeOutMessage,
                    city: log.city || 'N/A',
                    activeWorkingHours: activeWorkingHours.toFixed(2)
                };
            });
        };
        
    
            // Initialize attendanceLogs variable
            let attendanceLogs = [];
            let manpowerRequisitions = await fetchAndFormatMRFData();

            if (req.session.user.userRole === 'Line Manager') {
                const formattedLeaves = await fetchAndFormatLeaves();
                attendanceLogs = await fetchAttendanceLogs();
                const formattedAttendanceDisplay = formatAttendanceLogs(attendanceLogs);
    
                return res.render('staffpages/hr_pages/hrdashboard', {
                    formattedLeaves,
                    attendanceLogs: formattedAttendanceDisplay,
                    manpowerRequisitions,
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors'),
                });
    
            } else if (req.session.user.userRole === 'HR') {
                const [formattedAllLeaves, formattedApprovedLeaves] = await Promise.all([
                    fetchAndFormatLeaves(),
                    fetchAndFormatLeaves('Approved')
                ]);
    
                attendanceLogs = await fetchAttendanceLogs();
                const formattedAttendanceDisplay = formatAttendanceLogs(attendanceLogs);
    
                return res.render('staffpages/hr_pages/hrdashboard', { 
                    allLeaves: formattedAllLeaves, 
                    approvedLeaves: formattedApprovedLeaves,
                    attendanceLogs: formattedAttendanceDisplay,
                    manpowerRequisitions,
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors'),
                });
            }
        } catch (err) {
            console.error('Error fetching data for the dashboard:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the dashboard.' });
            return res.redirect('/hr/dashboard');
        }
    },

    getHRNotifications: async function(req, res) {
        // Check for authentication
        if (!req.session.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    
        try {
            // Fetch HR applicants with P1 status
            const { data: p1Applicants, error: p1ApplicantsError } = await supabase
                .from('applicantaccounts')
                .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId')
                .eq('applicantStatus', 'P1 - Awaiting for HR Action')
                .order('created_at', { ascending: false });
    
            if (p1ApplicantsError) throw p1ApplicantsError;
    
            // Fetch HR applicants with P2 evaluation status
            const { data: p2Applicants, error: p2ApplicantsError } = await supabase
                .from('applicantaccounts')
                .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId')
                .eq('applicantStatus', 'P2 - Awaiting for HR Evaluation')
                .order('created_at', { ascending: false });
    
            if (p2ApplicantsError) throw p2ApplicantsError;
    
            // Combine all HR applicants
            const allHRApplicants = [...p1Applicants, ...p2Applicants];
    
            // Format the HR applicants data - include jobId for redirect
            const formattedHRApplicants = allHRApplicants.map(applicant => ({
                id: applicant.applicantId,
                firstName: applicant.firstName || 'N/A',
                lastName: applicant.lastName || 'N/A',
                status: applicant.applicantStatus || 'N/A',
                jobId: applicant.jobId, // Added jobId for the redirect
                createdAt: applicant.created_at,
                formattedDate: new Date(applicant.created_at).toLocaleString('en-US', {
                    weekday: 'short', 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric', 
                    hour: '2-digit', 
                    minute: '2-digit'
                })
            }));
    
            // Fetch pending MRF data that needs action
            const { data: pendingMRFs, error: mrfError } = await supabase
                .from('mrf')
                .select('mrfId, positionTitle, requisitionDate, departmentId')
                .eq('status', 'Pending');
    
            if (mrfError) throw mrfError;
    
            // Fetch departments for pending MRFs
            const { data: departments, error: deptError } = await supabase
                .from('departments')
                .select('departmentId, deptName');
            
            if (deptError) throw deptError;
    
            // Format pending MRF data
            const formattedPendingMRFs = pendingMRFs.map(mrf => {
                const department = departments.find(d => d.departmentId === mrf.departmentId)?.deptName || 'N/A';
                
                return {
                    id: mrf.mrfId,
                    position: mrf.positionTitle,
                    department: department,
                    requestDate: new Date(mrf.requisitionDate).toLocaleString('en-US', {
                        weekday: 'short', 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric'
                    })
                };
            });
    
            // Improved API request detection - checking multiple conditions
            const isApiRequest = req.xhr || 
                                req.headers.accept?.includes('application/json') || 
                                req.path.includes('/api/');
    
            // If it's an API request, return JSON with explicit content type
            if (isApiRequest) {
                return res
                    .header('Content-Type', 'application/json')
                    .json({
                        hrApplicants: formattedHRApplicants,
                        pendingMRFs: formattedPendingMRFs,
                        notificationCount: formattedHRApplicants.length + formattedPendingMRFs.length
                    });
            }
    
            // Otherwise, return the rendered partial template
            return res.render('partials/hr_partials', {
                hrApplicants: formattedHRApplicants,
                pendingMRFs: formattedPendingMRFs,
                notificationCount: formattedHRApplicants.length + formattedPendingMRFs.length
            });
        } catch (err) {
            console.error('Error fetching notification data:', err);
            
            // Better error handling for API requests
            const isApiRequest = req.xhr || 
                               req.headers.accept?.includes('application/json') || 
                               req.path.includes('/api/');
            
            if (isApiRequest) {
                return res
                    .status(500)
                    .header('Content-Type', 'application/json')
                    .json({ 
                        error: 'An error occurred while loading notifications.',
                        details: process.env.NODE_ENV === 'development' ? err.message : undefined
                    });
            }
            
            return res.status(500).send('Error loading notifications');
        }
    },
    


    /* ATS CODES DIVIDER  */
    getApplicantTrackerAllJobPositions: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Fetch job positions and departments
                const { data: jobpositions, error: jobpositionsError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle, hiringStartDate, hiringEndDate, departmentId')
                    .order('hiringStartDate', { ascending: true });
    
                if (jobpositionsError) throw jobpositionsError;
    
                const { data: departments, error: departmentsError } = await supabase
                    .from('departments')
                    .select('deptName, departmentId');
    
                if (departmentsError) throw departmentsError;
    
                // Fetch all applicant accounts
                const { data: applicantaccounts, error: applicantaccountsError } = await supabase
                    .from('applicantaccounts')
                    .select('jobId, applicantStatus');
    
                if (applicantaccountsError) throw applicantaccountsError;
    
                // Log raw applicant accounts data
                console.log('Applicant Accounts:', applicantaccounts);
    
                // Group and count statuses by jobId
                const statusCountsMap = {};
                applicantaccounts.forEach(({ jobId, applicantStatus }) => {
                    if (!statusCountsMap[jobId]) {
                        statusCountsMap[jobId] = { P1: 0, P2: 0, P3: 0, Offered: 0, Onboarding: 0 };
                    }
                    
                    // Check if applicantStatus is not null or undefined before using includes()
                    if (applicantStatus) {
                        if (applicantStatus.includes('P1')) {
                            statusCountsMap[jobId].P1++;
                        } else if (applicantStatus.includes('P2')) {
                            statusCountsMap[jobId].P2++;
                        } else if (applicantStatus.includes('P3')) {
                            statusCountsMap[jobId].P3++;
                        } else if (applicantStatus.includes('Offered')) {
                            statusCountsMap[jobId].Offered++;
                        } else if (applicantStatus.includes('Onboarding')) {
                            statusCountsMap[jobId].Onboarding++;
                        }
                    }
                });
    
                // Log final counts for each jobId
                console.log('Status Counts Map:', statusCountsMap);
    
                // Merge counts into job positions
                const jobPositionsWithCounts = jobpositions.map((job) => ({
                    ...job,
                    departmentName: departments.find(dept => dept.departmentId === job.departmentId)?.deptName || 'Unknown',
                    counts: statusCountsMap[job.jobId] || { P1: 0, P2: 0, P3: 0, Offered: 0, Onboarding: 0 },
                }));
    
                // Render the page
                res.render('staffpages/hr_pages/hrapplicanttracking', {
                    jobPositions: jobPositionsWithCounts,
                    departments,
                });
            } catch (err) {
                console.error('Error:', err);
                req.flash('errors', { databaseError: 'Error fetching job data.' });
                res.redirect('/staff/login');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    
    
    
    getApplicantTrackerByJobPositions: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { jobId, applicantId, userId } = req.query;
                console.log('Received request with jobId:', jobId, 'and applicantId:', applicantId);
                console.log('Received request with userId:', userId);

    
                // if (applicantId) {
                //     const { error: updateError } = await supabase
                //         .from('applicantaccounts')
                //         .update({ LM_notified: true })
                //         .eq('applicantId', applicantId);
    
                //     if (updateError) {
                //         console.error('Error updating LM_notified:', updateError);
                //         return res.status(500).json({ success: false, error: 'Failed to notify Line Manager' });
                //     }
    
                //     return res.json({ success: true, message: 'Line Manager notified successfully' });
                // }
    
                const { data: applicants, error: applicantError } = await supabase
    .from('applicantaccounts')
    .select(`
        lastName, 
        firstName, 
        phoneNo,
        userId,
        jobId,
        departmentId,
        birthDate,
        applicantStatus,
        applicantId,
        hrInterviewFormScore,
        initialScreeningScore,
        p2_Approved,
        p2_hrevalscheduled
    `)
    .eq('jobId', jobId);

    if (applicantError) {
        console.error('Error fetching applicants:', applicantError);
        throw applicantError;
    }
    console.log('Fetched applicants:', applicants);

// Fetch initial screening assessments separately
const { data: screeningAssessments, error: screeningError } = await supabase
    .from('applicant_initialscreening_assessment')
    .select(`
        userId,
        initialScreeningId,
        degreeScore,
        experienceScore,
        certificationScore,
        hardSkillsScore,
        softSkillsScore,
        workSetupScore,
        availabilityScore,
        totalScore,
        totalScoreCalculatedAt,
        degree_url,
        cert_url,
        resume_url,
        isHRChosen,
        isLineManagerChosen
    `);

    if (screeningError) {
        console.error('Error fetching screening assessments:', screeningError);
        throw screeningError;
    }
    console.log('Fetched screening assessments:', screeningAssessments);

    
                const { data: userAccounts, error: userError } = await supabase
                    .from('useraccounts')
                    .select('userId, userEmail');
    
                if (userError) throw userError;
    
                const { data: jobTitles, error: jobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle');
    
                if (jobError) throw jobError;
    
                const { data: departments, error: departmentError } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
    
                    if (departmentError) {
                        console.error('Error fetching departments:', departmentError);
                        throw departmentError;
                    }
                    console.log('Fetched departments:', departments);
    
                for (const applicant of applicants) {
                    console.log(`Processing applicant: ${applicant.firstName} ${applicant.lastName}`);

                    // let formattedStatus = applicant.applicantStatus;
    
                    // ✅ NEW: If HR Evaluation Score is not 0, update the status to 'P2 - HR Evaluation Accomplished'
                    // if (applicant.hrInterviewFormScore && applicant.hrInterviewFormScore > 0) {
                    //     formattedStatus = `P2 - HR Evaluation Accomplished - Score: ${applicant.hrInterviewFormScore}`;
    
                    //     const { error: updateError } = await supabase
                    //         .from('applicantaccounts')
                    //         .update({ applicantStatus: formattedStatus })
                    //         .eq('applicantId', applicant.applicantId);
    
                    //     if (updateError) {
                    //         console.error(`Error updating applicant ${applicant.applicantId} to P2 - HR Evaluation Accomplished:`, updateError);
                    //     }
                    // }
                    // else if (applicant.p2_hrevalscheduled) {
                    //     formattedStatus = 'P2 - Awaiting for HR Evaluation';
    
                    //     const { error: updateError } = await supabase
                    //         .from('applicantaccounts')
                    //         .update({ applicantStatus: formattedStatus })
                    //         .eq('applicantId', applicant.applicantId);
    
                    //     if (updateError) {
                    //         console.error(`Error updating applicant ${applicant.applicantId} to P2 - Awaiting for HR Evaluation:`, updateError);
                    //     }
                    // } 
                    // else if (applicant.lineManagerApproved || formattedStatus === 'P1 - PASSED') {
                    //     formattedStatus = 'P2 - HR Screening Scheduled';
    
                    //     const { error: updateError } = await supabase
                    //         .from('applicantaccounts')
                    //         .update({ applicantStatus: formattedStatus })
                    //         .eq('applicantId', applicant.applicantId);
    
                    //     if (updateError) {
                    //         console.error(`Error updating applicant ${applicant.applicantId} to P2 - HR Screening Scheduled:`, updateError);
                    //     }
                    // } else {
                    // }
                       
    
                    // applicant.applicantStatus = formattedStatus;
                     // Assign job title, department name, and user email
    applicant.jobTitle = jobTitles.find(job => job.jobId === applicant.jobId)?.jobTitle || 'N/A';
    applicant.deptName = departments.find(dept => dept.departmentId === applicant.departmentId)?.deptName || 'N/A';
    applicant.userEmail = userAccounts.find(user => user.userId === applicant.userId)?.userEmail || 'N/A';
    applicant.birthDate = userAccounts.find(user => user.userId === applicant.userId)?.birthDate || 'N/A';


    // Match `userId` to fetch the corresponding initial screening assessment
    const screeningData = screeningAssessments.find(assessment => assessment.userId === applicant.userId) || {};

    // Merge the screening assessment data into the applicant object
    applicant.initialScreeningAssessment = {
        degreeScore: screeningData.degreeScore || 'N/A',
        experienceScore: screeningData.experienceScore || 'N/A',
        certificationScore: screeningData.certificationScore || 'N/A',
        hardSkillsScore: screeningData.hardSkillsScore || 'N/A',
        softSkillsScore: screeningData.softSkillsScore || 'N/A',
        workSetupScore: screeningData.workSetupScore || 'N/A',
        availabilityScore: screeningData.availabilityScore || 'N/A',
        totalScore: screeningData.totalScore || 'N/A',
        degree_url: screeningData.degree_url || '#',
        cert_url: screeningData.cert_url || '#',
        resume_url: screeningData.resume_url || '#',
    };

    console.log('Updated applicant details:', applicant);
}

console.log('Final applicants list:', applicants);

// Render the page with updated applicants
res.render('staffpages/hr_pages/hrapplicanttracking-jobposition', { applicants });
            } catch (error) {
                console.error('Error fetching applicants:', error);
                res.status(500).json({ error: 'Error fetching applicants' });
            }
        } else {
            console.warn('Unauthorized access attempt detected.');

            req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
            res.redirect('/staff/login');
        }
    },
    
    
    updateStatusToP1AwaitingforLineManager: async function(req, res) {
        const { userId } = req.body; // Only get userId from request body
    
        try {
            // Update `applicant_initialscreening_assessment` using `userId`
            const { error: assessmentError } = await supabase
                .from('applicant_initialscreening_assessment')
                .update({ isHRChosen: true })
                .eq('userId', userId);
            
            if (assessmentError) throw assessmentError;
    
            // Update `applicantaccounts` using `userId`
            const { error: statusError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: "P1 - Awaiting for Line Manager Action; HR PASSED" })
                .eq('userId', userId);
            
            if (statusError) throw statusError;
    
            res.json({ success: true, message: "Applicant status updated successfully.", userId });
        } catch (error) {
            res.json({ success: false, message: error.message });
        }
    },
    
    // postNotifyLineManager: async function(req, res) {
    //     console.log('Request Body:', req.body); // Log the entire request body
    
    //     if (req.session.user && req.session.user.userRole === 'HR') {
    //         const { applicantId } = req.body; // Destructure the applicantId from the request body
    
    //         console.log('Received ApplicantId:', applicantId);
    
    //         // Validate applicantId
    //         if (!applicantId) {
    //             return res.status(400).json({ success: false, error: 'Applicant ID is required.' });
    //         }
    
    //         try {
    //             // Step 1: Get userId from applicantaccounts using applicantId
    //             const { data: applicantData, error: applicantError } = await supabase
    //                 .from('applicantaccounts')
    //                 .select('userId')
    //                 .eq('applicantId', applicantId)
    //                 .single();
    
    //             if (applicantError || !applicantData) {
    //                 console.error('Error fetching userId:', applicantError);
    //                 return res.status(404).json({ success: false, error: 'Applicant not found.' });
    //             }
    
    //             const userId = applicantData.userId;
    //             console.log('Fetched UserId:', userId);
    
    //             // Step 2: Update isHRChosen in applicant_initialscreening_assessment where userId matches
    //             const { error: updateError } = await supabase
    //                 .from('applicant_initialscreening_assessment')
    //                 .update({ isHRChosen: true })
    //                 .eq('userId', userId);
    
    //             if (updateError) {
    //                 console.error('Error updating isHRChosen:', updateError);
    //                 throw updateError;
    //             }
    
    //             res.status(200).json({ success: true, message: 'Line Manager notified successfully.' });
    //         } catch (error) {
    //             console.error('Unexpected error:', error);
    //             return res.status(500).json({ success: false, error: 'Failed to notify Line Manager. Please try again.' });
    //         }
    //     } else {
    //         req.flash('errors', { authError: 'Unauthorized. HR access only.' });
    //         res.redirect('/staff/login');
    //     }
    // },
    
   
        // Controller method for viewing final results for an individual applicant
        getFinalResults: async function (req, res) {
            try {
                const userId = req.session.user?.userId; // Get the current user's ID (from session)
    
                if (!userId) {
                    req.flash('errors', { authError: 'Unauthorized. Access only for authorized users.' });
                    return res.redirect('/staff/login');
                }
    
                // Fetch the chatbot interaction history for the current applicant
                const { data: chatbotInteractions, error: chatbotError } = await supabase
                    .from('chatbot_interaction')
                    .select('message, response, timestamp, applicantStage')
                    .eq('userId', userId)
                    .order('timestamp', { ascending: true }); // Sort by timestamp in ascending order
    
                if (chatbotError) {
                    console.error('Error fetching chatbot interactions:', chatbotError);
                    return res.status(500).send('Error fetching chatbot interactions');
                }
    
                // If no interactions are found, send a relevant message to the view
                if (chatbotInteractions.length === 0) {
                    return res.render('staffpages/hr_pages/ats-final-results', {
                        error: "No interactions found for your application process.",
                        chatbotInteractions: [],
                        message: "There were no interactions to display.",
                        screeningQuestions: [],
                        answers: [],
                        weightedScores: [],
                        result: 'fail'
                    });
                }
    
                // Fetch screening questions and calculate weighted scores
                const screeningQuestions = req.session.screeningQuestions || [];
                const answers = req.session.answers || [];
                const { weightedScores, result } = await applicantController.calculateWeightedScores(
                    answers, 
                    req.session.selectedPosition, 
                    screeningQuestions
                );
    
                // Render the page with the chatbot interactions and additional data
                res.render('staffpages/hr_pages/ats-final-results', {
                    chatbotInteractions: chatbotInteractions, // Send the entire interaction history to the view
                    message: "Here is the entire interaction with the chatbot for your application process.",
                    error: null, // Send null for the error if no error occurs
                    screeningQuestions: screeningQuestions,
                    answers: answers,
                    weightedScores: weightedScores,
                    result: result
                });
    
            } catch (error) {
                console.error('Error fetching chatbot interaction history:', error);
                return res.status(500).send('Error fetching chatbot interaction history');
            }
        },
    
        getEvaluationForm: async function (req, res) {
            // Check if the user is logged in and has the 'HR' role
            if (req.session.user && req.session.user.userRole === 'HR') {
                const applicantId = req.params.applicantId; // Get applicantId from URL path
        
                try {
                    console.log('Fetching applicant details for applicantId:', applicantId);
        
                    // Parse applicantId to ensure it is a valid integer
                    const parsedApplicantId = parseInt(applicantId, 10);
                    if (isNaN(parsedApplicantId)) {
                        req.flash('errors', { message: 'Invalid Applicant ID format.' });
                        return res.redirect('/hr/applicant-tracker-jobposition');
                    }
        
                    // Fetch the applicant's details from the database
                    const { data: applicant, error } = await supabase
                        .from('applicantaccounts')
                        .select('*')
                        .eq('applicantId', parsedApplicantId)
                        .single();
        
                    // Log the response for debugging
                    console.log('Database Response:', { data: applicant, error });
        
                    // Handle database errors or missing applicant data
                    if (error || !applicant) {
                        console.error("Error fetching applicant details:", error || "Applicant not found.");
                        req.flash('errors', { message: 'Could not retrieve applicant details.' });
                        return res.redirect('/hr/applicant-tracker-jobposition');
                    }
        
                    console.log('Applicant Details:', applicant); // Log the applicant details for inspection
        
                    // Render the evaluation form with applicant details
                    res.render('staffpages/hr_pages/hr-eval-form', {
                        applicantId: parsedApplicantId,
                        applicant, // Pass the applicant details to the template
                    });
                } catch (err) {
                    // Handle unexpected server errors
                    console.error("Error loading evaluation form:", err);
                    req.flash('errors', { message: 'Internal server error.' });
                    return res.redirect('/hr/applicant-tracker-jobposition');
                }
            } else {
                // Redirect unauthorized users to the login page
                req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
                res.redirect('/staff/login');
            }
        },

    /* END OF ATS CODES DIVIDER  */
    
    
    
    
    
    
    

    
    
    
    
    
    
    
    
    
 

    //ARCHIVED
    // getApplicantTracking: async function (req, res) {
    //     if (!req.session.user) {
    //         req.flash('errors', { authError: 'Unauthorized. Access only for authorized users.' });
    //         return res.redirect('/staff/login');
    //     }
    
    //     try {
    //         const { data: applicants, error } = await supabase
    //             .from('applicantaccounts')
    //             .select('applicantId, firstName, lastName, userId, created_at') 
    //             .order('created_at', { ascending: false }); 
    
    //         if (error) {
    //             console.error('Error fetching applicants:', error);
    //             return res.status(500).send('Error fetching applicants');
    //         }
    
    //         for (let applicant of applicants) {
    //             const { data: chatbotResponses, error: chatbotError } = await supabase
    //                 .from('chatbot_interaction')
    //                 .select('message, response, applicantStage')
    //                 .eq('userId', applicant.userId)
    //                 .order('timestamp', { ascending: true });
    
    //             if (chatbotError) {
    //                 console.error('Error fetching chatbot responses:', chatbotError);
    //                 return res.status(500).send('Error fetching chatbot responses');
    //             }
    
    //             // Find the position applied from the chatbot messages
    //             const positionAppliedMessage = chatbotResponses.find(response => response.message.toLowerCase().includes("position applied"));
    //             applicant.positionApplied = positionAppliedMessage ? positionAppliedMessage.message.split(":")[1].trim() : "N/A";  // Extract position after the colon
    
    //             // Find the application status based on the applicantStage
    //             const applicationStatusMessage = chatbotResponses.find(response => response.applicantStage === "application_complete" || response.applicantStage === "final_status");
    //             applicant.applicationStatus = applicationStatusMessage ? "Completed" : "Pending";  // Assuming 'Completed' if found, otherwise 'Pending'
    //         }
    
    //         res.render('staffpages/hr_pages/applicant-tracking-system', { applicants });
    
    //     } catch (error) {
    //         console.error('Error:', error);
    //         return res.status(500).send('Error fetching applicants');
    //     }
    // },        

    getHROnboarding: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hr-onboarding');
        } else {
            req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
            res.redirect('staff/login');
        }
    },
    
    getManageLeaveTypes: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Fetch leave types from the Supabase database
                const { data: leaveTypes, error } = await supabase
                    .from('leave_types')
                    .select('leaveTypeId, typeName, typeMaxCount, typeIsActive');
    
                if (error) {
                    throw error; // Handle error
                }
    
                // Process the leave types to send to frontend
                const processedLeaveTypes = leaveTypes.map(leaveType => ({
                    leaveTypeId: leaveType.leaveTypeId,
                    typeName: leaveType.typeName,
                    typeMaxCount: leaveType.typeMaxCount,
                    typeIsActive: leaveType.typeIsActive // Keep it as a boolean
                }));
    
                // Send response with leave types
                res.render('staffpages/hr_pages/hrmanageleavetypes', { 
                    leaveTypes: processedLeaveTypes 
                });
            } catch (err) {
                console.error("Error fetching leave types:", err);
                req.flash('errors', { dbError: 'An error occurred while loading leave types.' });
                res.redirect('/hr/dashboard'); 
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    
    updateLeaveTypes: async (req, res) => {
        const { typeMaxCount, typeIsActive } = req.body; 
        const { leaveTypeId } = req.params; 
    
        try {
            const isActive = typeIsActive === 'true'; // Ensure it's a boolean
    
            const { data, error } = await supabase
                .from('leave_types')
                .update({
                    typeMaxCount: typeMaxCount,
                    typeIsActive: isActive // Use boolean value
                })
                .eq('leaveTypeId', leaveTypeId);
    
            if (error) {
                return res.status(400).json({ message: 'Error updating leave type', error });
            }
    
            res.status(200).json({ message: 'Leave type updated successfully', data });
        } catch (err) {
            console.error('Error updating leave type:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    },
    
    
    getUserAccount: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null; // Safely access userId
            if (!userId) {
                req.flash('errors', { authError: 'User not logged in.' });
                return res.redirect('/staff/login');
            }
    
            const { data: user, error } = await supabase
                .from('useraccounts')
                .select('userEmail, userRole')
                .eq('userId', userId)
                .single();
    
            const { data: staff, error: staffError } = await supabase
                .from('staffaccounts')
                .select(`
                    firstName, 
                    lastName, 
                    departments(deptName), 
                    jobpositions(jobTitle)
                `)
                .eq('userId', userId)
                .single();
    
            if (error || staffError) {
                console.error('Error fetching user or staff details:', error || staffError);
                req.flash('errors', { dbError: 'Error fetching user data.' });
                return res.redirect('/staff/employee/dashboard');
            }
    
            // Fetch offboarding requests for this user
            const { data: offboardingRequests, error: offboardingError } = await supabase
                .from('offboarding_requests')
                .select('*')
                .eq('userId', userId)
                .order('created_at', { ascending: false });
    
            if (offboardingError) {
                console.error('Error fetching offboarding requests:', offboardingError);
                // Don't redirect, just log the error and continue
            }
    
            const userData = {
                ...user,
                firstName: staff.firstName,
                lastName: staff.lastName,
                deptName: staff.departments.deptName,
                jobTitle: staff.jobpositions.jobTitle
            };
    
            res.render('staffpages/employee_pages/useracc', { 
                user: userData,
                offboardingRequests: offboardingRequests || [] // Pass empty array if null
            });
        } catch (err) {
            console.error('Error in getUserAccount controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the account page.' });
            res.redirect('/staff/employee/dashboard');
        }
    },
    

    updateUserInfo: async function (req, res) {
        try {
            const userId = req.session.user.userId;
            const { firstName, lastName, userEmail } = req.body;

            // Update the user info in both 'useraccounts' and 'staffaccounts' tables
            const { error: userError } = await supabase
                .from('useraccounts')
                .update({ userEmail })
                .eq('userId', userId);

            const { error: staffError } = await supabase
                .from('staffaccounts')
                .update({ firstName, lastName })
                .eq('userId', userId);

            if (userError || staffError) {
                console.error('Error updating user information:', userError || staffError);
                req.flash('errors', { dbError: 'Error updating user information.' });
                return res.redirect('staffpages/hr_pages/hruseraccount');
            }

            req.flash('success', 'User information updated successfully!');
            res.redirect('staffpages/hr_pages/hruseraccount');
        } catch (err) {
            console.error('Error in updateUserInfo controller:', err);
            req.flash('errors', { dbError: 'An error occurred while updating the information.' });
            res.redirect('staffpages/hr_pages/hruseraccount')
        }
    },

    getPersInfoCareerProg: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            const { data: user, error } = await supabase
                .from('useraccounts')
                .select('userEmail, userRole')
                .eq('userId', userId)
                .single();
    
            const { data: staff, error: staffError } = await supabase
                .from('staffaccounts')
                .select('firstName, lastName')
                .eq('userId', userId)
                .single();
    
            if (error || staffError) {
                console.error('Error fetching user or staff details:', error || staffError);
                req.flash('errors', { dbError: 'Error fetching user data.' });
                return res.redirect('/hr/dashboard');
            }
    
            const userData = {
                ...user,
                firstName: staff.firstName,
                lastName: staff.lastName,
                phoneNumber: '123-456-7890', // Dummy phone number
                dateOfBirth: '1990-01-01', // Dummy date of birth
                emergencyContact: 'Jane Doe (123-456-7890)' // Dummy emergency contact
            };
    
            res.render('staffpages/hr_pages/persinfocareerprog', { user: userData });
        } catch (err) {
            console.error('Error in getPersInfoCareerProg controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the page.' });
            res.redirect('/hr/dashboard');
        }
    },

    updatePersUserInfo: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            const { userEmail, phone, dateOfBirth, emergencyContact, employmentType, jobTitle, department, hireDate } = req.body;
    
            const { error: userError } = await supabase
                .from('useraccounts')
                .update({
                    userEmail,
                    phone, 
                    dateOfBirth, 
                    emergencyContact 
                })
                .eq('userId', userId);
    
            if (userError) {
                console.error('Error updating user account:', userError);
                req.flash('errors', { dbError: 'Error updating user information.' });
                return res.redirect('staffpages/hr_pages/persinfocareerprog');
            }

            const { error: staffError } = await supabase
                .from('staffaccounts')
                .update({
                    employmentType,
                    jobTitle,
                    department,
                    hireDate
                })
                .eq('userId', userId);
    
            if (staffError) {
                console.error('Error updating staff account:', staffError);
                req.flash('errors', { dbError: 'Error updating staff information.' });
                return res.redirect('staffpages/hr_pages/persinfocareerprog');
            }
    
            req.flash('success', { updateSuccess: 'User information updated successfully!' });
            res.redirect('staffpages/hr_pages/persinfocareerprog');
    
        } catch (err) {
            console.error('Error in updateUserInfo controller:', err);
            req.flash('errors', { dbError: 'An error occurred while updating the information.' });
            res.redirect('staffpages/hr_pages/persinfocareerprog');
        }
    },
    

    getHRManageHome: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // fetch announcements from the database
                const { data: announcements, error } = await supabase
                    .from('announcements')
                    .select('*')
                    .order('createdAt', { ascending: false });
    
                if (error) throw error;
    
                res.render('staffpages/hr_pages/hrmanagehome', { announcements });
            } catch (error) {
                console.error('Error fetching announcements:', error);
                req.flash('errors', { fetchError: 'Failed to load announcements. Please try again.' });
                res.redirect('/hr/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    

    getAddAnnouncement: function(req, res){
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hraddannouncement');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    postAddAnnouncement: async function(req, res) {
        console.log('Request Body:', req.body); // Log the entire request body
        
        if (req.session.user && req.session.user.userRole === 'HR') {
        const { subject, content } = req.body; // Destructure the subject and content from the request body

        console.log('Received Subject:', subject);
        console.log('Received Content:', content);

        // Validate subject and content
        if (!subject || !content) {
            return res.status(400).json({ error: 'Subject and content are required.' });
        }

        try {
            const { data: announcements, error } = await supabase
                .from('announcements')
                .insert([{
                    subject,
                    imageUrl: null, // Set to null if no file is uploaded
                    content,
                    createdAt: new Date()
                }]);
            
            if (error) throw error;

            req.flash('success', 'Announcement added successfully!');
            res.status(200).json({ success: true });
            } catch (error) {
                console.error('Error adding announcement:', error);
                return res.status(500).json({ error: 'Failed to add announcement. Please try again' });
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    getEditAnnouncement: async function(req, res) {
        const { announcementID } = req.params;
        
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { data: announcement, error } = await supabase
                    .from('announcements')
                    .select('*')
                    .eq('id', announcementID)
                    .single(); 

                if (error) throw error;

                res.render('staffpages/hr_pages/hreditannouncement', { announcement });
            } catch (error) {
                console.error('Error fetching announcement:', error);
                req.flash('errors', { fetchError: 'Failed to load announcement. Please try again.' });
                res.redirect('/hr/managehome');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    updateAnnouncement: async function(req, res) {
        const { announcementID } = req.params;
        const { subject, content } = req.body;
    
        console.log('Update Request Body:', req.body); 
    
        if (req.session.user && req.session.user.userRole === 'HR') {

            if (!subject || !content) {
                return res.status(400).json({ error: 'Subject and content are required.' });
            }
    
            try {
                const { error } = await supabase
                    .from('announcements')
                    .update({ subject, content, updatedAt: new Date() }) 
                    .eq('id', announcementID); 
    
                if (error) throw error;
    
                req.flash('success', 'Announcement updated successfully.');
                res.redirect('/hr/managehome'); 
            } catch (error) {
                console.error('Error updating announcement:', error);
                req.flash('errors', { updateError: 'Failed to update announcement. Please try again.' });
                res.redirect(`/hr/editannouncement/${announcementID}`); 
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    deleteAnnouncement: async function (req, res) {
        const { announcementID } = req.params;

        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { error } = await supabase
                    .from('announcements')
                    .delete()
                    .eq('announcementID', announcementID);

                if (error) throw error;

                res.status(200).send('Announcement deleted successfully.');
            } catch (error) {
                console.error('Error deleting announcement:', error);
                res.status(500).send('Failed to delete announcement. Please try again.');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only. '});
            res.redirect('/staff/login');
        }
    },

    getViewMRF: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const mrfId = req.params.id; 
    
                const { data: mrfData, error: mrfError } = await supabase
                    .from('mrf')
                    .select('*')
                    .eq('mrfId', mrfId)
                    .single(); 

                if (mrfError) throw mrfError;

                const { data: departmentData, error: deptError } = await supabase
                    .from('departments')
                    .select('deptName')
                    .eq('departmentId', mrfData.departmentId)
                    .single();

                if (deptError) throw deptError;
    
                res.render('staffpages/hr_pages/hr-view-mrf', { 
                    mrf: mrfData,
                    department: departmentData ? departmentData.deptName : 'N/A' 
                });
            } catch (error) {
                console.error("Error in getViewMRF:", error);
                req.flash('errors', { fetchError: 'Error fetching MRF details. Please try again later.' });
                res.redirect('/hr/dashboard'); 
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    submitMRF: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            return res.redirect('/staff/login');
        }
    
        console.log("Request Body:", req.body);  
    
        if (!req.body.mrfId) {
            console.error("Missing mrfId in request body");
            req.flash('errors', { submissionError: 'MRF ID is missing. Please try again.' });
            return res.redirect('/hr/dashboard');
        }
    
        const approvalStatus = req.body.hrApproval ? 'approved' : (req.body.hrDisapproval ? 'disapproved' : 'pending');
        const disapprovalReason = req.body.disapprovalReason || ''; 
    
        if (!['approved', 'disapproved', 'pending'].includes(approvalStatus)) {
            console.error('Invalid approval status:', approvalStatus);
            req.flash('errors', { submissionError: 'Invalid approval status. Please try again.' });
            return res.redirect('/hr/dashboard');
        }
    
        const approvalData = {
            mrfId: req.body.mrfId,  
            staffId: req.session.user.userId,
            approval_stage: req.session.user.userRole,
            reviewerName: req.session.user.userName || 'HR',  
            reviewerDateSigned: new Date().toISOString(),
            approvalStatus: approvalStatus,  // 'approved' or 'disapproved' or 'pending'
            disapprovalReason: disapprovalReason 
        };
    
        try {
            const { data: approvalDataInserted, error: approvalError } = await supabase
                .from('mrf_approvals')
                .insert([approvalData])
                .select();
    
            if (approvalError) {
                console.error("Supabase Error (Insert Approval):", approvalError.message, approvalError.details);
                throw approvalError;
            }
    
            console.log("Approval data inserted:", approvalDataInserted);
    
            let newMrfStatus = "Action Required";  
            
            if (approvalStatus === 'approved') {
                newMrfStatus = "Approved";
            } else if (approvalStatus === 'disapproved') {
                newMrfStatus = "Disapproved";
            }
    
            const { data: mrfUpdateData, error: mrfUpdateError } = await supabase
                .from('mrf')
                .update({ status: newMrfStatus })  // Update status in mrf table
                .eq('mrfId', req.body.mrfId) 
                .select(); 
    
            if (mrfUpdateError) {
                console.error("Error updating MRF status:", mrfUpdateError.message, mrfUpdateError.details);
                throw mrfUpdateError;
            }
    
            console.log("MRF status updated:", mrfUpdateData);
    
            req.flash('success', { message: 'MRF Approval/Disapproval submitted successfully!' });
            return res.redirect('/hr/dashboard');  
    
        } catch (error) {
            console.error("Error in MRF submission or approval insertion:", error);
            req.flash('errors', { submissionError: 'Failed to submit MRF approval. Please try again.' });
            return res.redirect('/hr/dashboard');
        }
    },  

    getJobOffers: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { data: jobPositions, error } = await supabase
                    .from('jobpositions')
                    .select(`
                        *,
                        departments (deptName)  // fetching the department name from the departments table
                    `);
    
                if (error) throw error;

                // to be deleted later on
                console.log('Job Positions:', jobPositions);

                // mapping to include dept names instead of deptId
                const jobPositionsWithNames = jobPositions.map(position => ({
                    ...position,
                    department: position.departments ? position.departments.deptName : 'Unknown'
                }));
            
                res.render('staffpages/hr_pages/hrjoboffers', { jobPositions: jobPositionsWithNames });
            } catch (error) {
                console.error('Error fetching job postings:', error);
                req.flash('errors', { fetchError: 'Failed to load job postings. Please try again.' });
                res.redirect('/hr/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    // Controller function to handle job offer update
// Updated updateJobOffer function to correctly handle form data
updateJobOffer: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'HR') {
        try {
            const jobId = req.params.id;
            const { 
                jobTitle, 
                jobDescrpt, 
                isActiveHiring,
                isActiveJob,  
                hiringStartDate,  
                hiringEndDate,    
                remove_id // Array of IDs to remove
            } = req.body;

            // Process checkbox values
            const isHiringActive = isActiveHiring === 'on' || isActiveHiring === true;
            const isJobActive = isActiveJob === 'on' || isActiveJob === true;

            // Log the selected job title and date values for debugging
            console.log('Selected Job Title:', jobTitle);
            console.log('Hiring Start Date:', hiringStartDate);
            console.log('Hiring End Date:', hiringEndDate);
            console.log('isActiveHiring:', isHiringActive);
            console.log('isActiveJob:', isJobActive);

            // Update the main job offer in the 'jobpositions' table
            const { error: jobUpdateError } = await supabase
                .from('jobpositions')
                .update({
                    jobTitle,  
                    jobDescrpt,
                    isActiveHiring: isHiringActive,  // Use the processed boolean value
                    isActiveJob: isJobActive,        // Use the processed boolean value
                    hiringStartDate: hiringStartDate || null,
                    hiringEndDate: hiringEndDate || null
                })
                .eq('jobId', jobId);

            if (jobUpdateError) throw jobUpdateError;

            // Handle removing items if any IDs were provided
            if (remove_id) {
                // Convert to array if it's a single value
                const removeIds = Array.isArray(remove_id) ? remove_id : [remove_id];
                
                // Process each ID to determine which table it belongs to
                for (const id of removeIds) {
                    // Check each table to find and remove the item
                    
                    // Try to remove from skills
                    const { error: skillRemoveError } = await supabase
                        .from('jobreqskills')
                        .delete()
                        .eq('jobReqSkillId', id);
                    
                    if (!skillRemoveError) {
                        console.log(`Successfully removed skill with ID: ${id}`);
                        continue; // Move to next ID if this one was removed successfully
                    }
                    
                    // Try to remove from certifications
                    const { error: certRemoveError } = await supabase
                        .from('jobreqcertifications')
                        .delete()
                        .eq('jobReqCertificateId', id);
                    
                    if (!certRemoveError) {
                        console.log(`Successfully removed certification with ID: ${id}`);
                        continue;
                    }
                    
                    // Try to remove from degrees
                    const { error: degreeRemoveError } = await supabase
                        .from('jobreqdegrees')
                        .delete()
                        .eq('jobReqDegreeId', id);
                    
                    if (!degreeRemoveError) {
                        console.log(`Successfully removed degree with ID: ${id}`);
                        continue;
                    }
                    
                    // Try to remove from experiences
                    const { error: expRemoveError } = await supabase
                        .from('jobreqexperiences')
                        .delete()
                        .eq('jobReqExperienceId', id);
                    
                    if (!expRemoveError) {
                        console.log(`Successfully removed experience with ID: ${id}`);
                        continue;
                    }
                    
                    console.log(`Could not find item with ID: ${id} in any table`);
                }
            }

            // Process existing skills
            const skillUpdates = [];
            for (const [key, value] of Object.entries(req.body)) {
                if (key.startsWith('skill_')) {
                    const skillId = key.replace('skill_', '');
                    skillUpdates.push({
                        jobReqSkillId: skillId,
                        jobReqSkillName: value
                    });
                }
            }

            // Handle skill updates
            for (const skill of skillUpdates) {
                const { error: skillUpdateError } = await supabase
                    .from('jobreqskills')
                    .update({ jobReqSkillName: skill.jobReqSkillName })
                    .eq('jobReqSkillId', skill.jobReqSkillId);
                
                if (skillUpdateError) throw skillUpdateError;
            }

            // Process new skills
            const newSkillNames = Array.isArray(req.body.new_skill_name) 
                ? req.body.new_skill_name 
                : (req.body.new_skill_name ? [req.body.new_skill_name] : []);
            
            const newSkillTypes = Array.isArray(req.body.new_skill_type)
                ? req.body.new_skill_type
                : (req.body.new_skill_type ? [req.body.new_skill_type] : []);

            if (newSkillNames.length > 0) {
                const newSkills = newSkillNames.map((name, index) => ({
                    jobId: jobId,
                    jobReqSkillName: name,
                    jobReqSkillType: newSkillTypes[index] || 'Hard' // Default to Hard if type not specified
                }));

                const { error: newSkillError } = await supabase
                    .from('jobreqskills')
                    .insert(newSkills);
                
                if (newSkillError) throw newSkillError;
            }

            // Process existing certifications
            const certUpdates = [];
            for (const [key, value] of Object.entries(req.body)) {
                if (key.startsWith('cert_')) {
                    const certType = key.replace('cert_', '');
                    certUpdates.push({
                        jobReqCertificateType: certType,
                        jobReqCertificateDescrpt: value
                    });
                }
            }

            // Handle certification updates
            for (const cert of certUpdates) {
                const { error: certUpdateError } = await supabase
                    .from('jobreqcertifications')
                    .update({ jobReqCertificateDescrpt: cert.jobReqCertificateDescrpt })
                    .eq('jobReqCertificateType', cert.jobReqCertificateType)
                    .eq('jobId', jobId);
                
                if (certUpdateError) throw certUpdateError;
            }

            // Process new certifications
            const newCertTypes = Array.isArray(req.body.new_cert_type) 
                ? req.body.new_cert_type 
                : (req.body.new_cert_type ? [req.body.new_cert_type] : []);
            
            const newCertDescs = Array.isArray(req.body.new_cert_desc)
                ? req.body.new_cert_desc
                : (req.body.new_cert_desc ? [req.body.new_cert_desc] : []);

            if (newCertTypes.length > 0) {
                const newCerts = newCertTypes.map((type, index) => ({
                    jobId: jobId,
                    jobReqCertificateType: type,
                    jobReqCertificateDescrpt: newCertDescs[index] || ''
                }));

                const { error: newCertError } = await supabase
                    .from('jobreqcertifications')
                    .insert(newCerts);
                
                if (newCertError) throw newCertError;
            }

            // Similar processing for degrees
            const degreeUpdates = [];
            for (const [key, value] of Object.entries(req.body)) {
                if (key.startsWith('degree_')) {
                    const degreeType = key.replace('degree_', '');
                    degreeUpdates.push({
                        jobReqDegreeType: degreeType,
                        jobReqDegreeDescrpt: value
                    });
                }
            }

            for (const degree of degreeUpdates) {
                const { error: degreeUpdateError } = await supabase
                    .from('jobreqdegrees')
                    .update({ jobReqDegreeDescrpt: degree.jobReqDegreeDescrpt })
                    .eq('jobReqDegreeType', degree.jobReqDegreeType)
                    .eq('jobId', jobId);
                
                if (degreeUpdateError) throw degreeUpdateError;
            }

            // Process new degrees
            const newDegreeTypes = Array.isArray(req.body.new_degree_type) 
                ? req.body.new_degree_type 
                : (req.body.new_degree_type ? [req.body.new_degree_type] : []);
            
            const newDegreeDescs = Array.isArray(req.body.new_degree_desc)
                ? req.body.new_degree_desc
                : (req.body.new_degree_desc ? [req.body.new_degree_desc] : []);

            if (newDegreeTypes.length > 0) {
                const newDegrees = newDegreeTypes.map((type, index) => ({
                    jobId: jobId,
                    jobReqDegreeType: type,
                    jobReqDegreeDescrpt: newDegreeDescs[index] || ''
                }));

                const { error: newDegreeError } = await supabase
                    .from('jobreqdegrees')
                    .insert(newDegrees);
                
                if (newDegreeError) throw newDegreeError;
            }

            // Similar processing for experiences
            const experienceUpdates = [];
            for (const [key, value] of Object.entries(req.body)) {
                if (key.startsWith('experience_')) {
                    const expType = key.replace('experience_', '');
                    experienceUpdates.push({
                        jobReqExperienceType: expType,
                        jobReqExperienceDescrpt: value
                    });
                }
            }

            for (const exp of experienceUpdates) {
                const { error: expUpdateError } = await supabase
                    .from('jobreqexperiences')
                    .update({ jobReqExperienceDescrpt: exp.jobReqExperienceDescrpt })
                    .eq('jobReqExperienceType', exp.jobReqExperienceType)
                    .eq('jobId', jobId);
                
                if (expUpdateError) throw expUpdateError;
            }

            // Process new experiences
            const newExpTypes = Array.isArray(req.body.new_experience_type) 
                ? req.body.new_experience_type 
                : (req.body.new_experience_type ? [req.body.new_experience_type] : []);
            
            const newExpDescs = Array.isArray(req.body.new_experience_desc)
                ? req.body.new_experience_desc
                : (req.body.new_experience_desc ? [req.body.new_experience_desc] : []);

            if (newExpTypes.length > 0) {
                const newExps = newExpTypes.map((type, index) => ({
                    jobId: jobId,
                    jobReqExperienceType: type,
                    jobReqExperienceDescrpt: newExpDescs[index] || ''
                }));

                const { error: newExpError } = await supabase
                    .from('jobreqexperiences')
                    .insert(newExps);
                
                if (newExpError) throw newExpError;
            }

            req.flash('success', { message: 'Job offer updated successfully!' });
            res.redirect('/hr/joboffers');
        } catch (error) {
            console.error('Error updating job offer:', error);
            req.flash('errors', { updateError: 'Failed to update job offer. Please try again.' });
            res.redirect(`/hr/editjoboffers/${req.params.id}`);
        }
    } else {
        req.flash('errors', { authError: 'Unauthorized. HR access only.' });
        res.redirect('/staff/login');
    }
},
    
    getAddJobOffer: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hraddjoboffers');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    postAddJobOffer: async function (req, res) {
        // Check if the user is HR
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Extract data from the request body
                const {
                    jobTitle, departmentId, jobDescrpt, jobType, jobTimeCommitment,
                    jobTimeCommitment_startTime, jobTimeCommitment_endTime,
                    hiringStartDate, hiringEndDate,
                    jobReqCertificateType, jobReqCertificateDescrpt,
                    jobReqDegreeType, jobReqDegreeDescrpt,
                    jobReqExperienceType, jobReqExperienceDescrpt, jobReqSkillType, jobReqSkillName
                } = req.body;
    
                console.log('Processing job offer submission for:', jobTitle);
    
                // Determine if the job is currently active based on hiring dates
                const currentDate = new Date();
                const startDate = new Date(hiringStartDate);
                const endDate = new Date(hiringEndDate);
                const isActiveHiring = currentDate >= startDate && currentDate <= endDate;
    
                // Step 1: Check if the selected job title already exists
                const { data: existingJob, error: existingJobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle')
                    .eq('jobId', jobTitle);
    
                if (existingJobError) {
                    console.error('Error checking existing job:', existingJobError);
                    throw existingJobError;
                }
    
                let jobId;
    
                // Step 2: If the job exists, use the existing jobId
                if (existingJob && existingJob.length > 0) {
                    jobId = existingJob[0].jobId;
                    console.log('Using existing job with ID:', jobId);
    
                    // Update the existing job row
                    const { error: updateError } = await supabase
                        .from('jobpositions')
                        .update({
                            jobDescrpt,
                            jobType,
                            jobTimeCommitment,
                            jobTimeCommitment_startTime,
                            jobTimeCommitment_endTime,
                            hiringStartDate,
                            hiringEndDate,
                            isActiveHiring
                        })
                        .eq('jobId', jobId);
    
                    if (updateError) {
                        console.error('Error updating job:', updateError);
                        throw updateError;
                    }
                } else {
                    // This shouldn't happen because we're selecting a job from dropdown
                    console.error('Job ID not found:', jobTitle);
                    return res.status(404).json({ error: 'Job title not found. Please select a valid job title.' });
                }
    
                // Step 3: Handle Job Requirements Insertion/Update
    
                // Function to insert or update job requirements (certificates, degrees, etc.)
                const upsertData = async (tableName, data, matchingField) => {
                    if (!data || data.length === 0 || !Array.isArray(data)) {
                        console.log(`No ${tableName} data to upsert`);
                        return;
                    }
                    
                    console.log(`Upserting ${data.length} records to ${tableName}`);
                    
                    // First remove existing records for this job
                    const { error: deleteError } = await supabase
                        .from(tableName)
                        .delete()
                        .eq('jobId', jobId);
                    
                    if (deleteError) {
                        console.error(`Error deleting existing records from ${tableName}:`, deleteError);
                        throw deleteError;
                    }
                    
                    // Then insert all new records
                    const { error: insertError } = await supabase
                        .from(tableName)
                        .insert(data);
                    
                    if (insertError) {
                        console.error(`Error inserting records into ${tableName}:`, insertError);
                        throw insertError;
                    }
                    
                    console.log(`Successfully upserted data to ${tableName}`);
                };
    
                // Prepare and upsert certifications if provided
                if (jobReqCertificateType && jobReqCertificateDescrpt) {
                    // Ensure both arrays exist and have the same length
                    if (Array.isArray(jobReqCertificateType) && Array.isArray(jobReqCertificateDescrpt) && 
                        jobReqCertificateType.length === jobReqCertificateDescrpt.length) {
                        
                        const certData = jobReqCertificateType.map((type, index) => ({
                            jobId,
                            jobReqCertificateType: type,
                            jobReqCertificateDescrpt: jobReqCertificateDescrpt[index]
                        }));
                        await upsertData('jobreqcertifications', certData, 'jobReqCertificateType');
                    } else {
                        console.warn('Mismatched certification data arrays, skipping.');
                    }
                }
    
                // Prepare and upsert degrees if provided
                if (jobReqDegreeType && jobReqDegreeDescrpt) {
                    // Ensure both arrays exist and have the same length
                    if (Array.isArray(jobReqDegreeType) && Array.isArray(jobReqDegreeDescrpt) && 
                        jobReqDegreeType.length === jobReqDegreeDescrpt.length) {
                        
                        const degreeData = jobReqDegreeType.map((type, index) => ({
                            jobId,
                            jobReqDegreeType: type,
                            jobReqDegreeDescrpt: jobReqDegreeDescrpt[index]
                        }));
                        await upsertData('jobreqdegrees', degreeData, 'jobReqDegreeType');
                    } else {
                        console.warn('Mismatched degree data arrays, skipping.');
                    }
                }
    
                // Prepare and upsert experiences if provided
                if (jobReqExperienceType && jobReqExperienceDescrpt) {
                    // Ensure both arrays exist and have the same length
                    if (Array.isArray(jobReqExperienceType) && Array.isArray(jobReqExperienceDescrpt) && 
                        jobReqExperienceType.length === jobReqExperienceDescrpt.length) {
                        
                        const experienceData = jobReqExperienceType.map((type, index) => ({
                            jobId,
                            jobReqExperienceType: type,
                            jobReqExperienceDescrpt: jobReqExperienceDescrpt[index]
                        }));
                        await upsertData('jobreqexperiences', experienceData, 'jobReqExperienceType');
                    } else {
                        console.warn('Mismatched experience data arrays, skipping.');
                    }
                }
    
                // Prepare and upsert skills if provided
                if (jobReqSkillType && jobReqSkillName) {
                    // Ensure both arrays exist and have the same length
                    if (Array.isArray(jobReqSkillType) && Array.isArray(jobReqSkillName) && 
                        jobReqSkillType.length === jobReqSkillName.length) {
                        
                        const skillData = jobReqSkillType.map((type, index) => ({
                            jobId,
                            jobReqSkillType: type,
                            jobReqSkillName: jobReqSkillName[index]
                        }));
                        await upsertData('jobreqskills', skillData, 'jobReqSkillType');
                    } else {
                        console.warn('Mismatched skill data arrays, skipping.');
                    }
                }
    
                console.log('Job posting successfully saved/updated');
                
                // Success response: redirect to job postings page
                res.redirect('/hr/joboffers');
    
            } catch (error) {
                console.error('Error adding or updating job postings and requirements:', error);
                // Handle error response
                res.status(500).json({ error: 'Failed to add or update job posting. Please try again.' });
            }
        } else {
            // Handle unauthorized access
            res.status(403).json({ errors: 'Unauthorized. HR access only.' });
        }
    },
    
    getEditJobOffers: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const jobId = req.params.id;  // Get jobId from URL params
                console.log('Requested Job ID:', jobId);  // Log the requested job ID
        
                // Fetch job details along with department information
                const { data: job, error } = await supabase
                    .from('jobpositions')
                    .select(`
                        *,
                        departments (deptName)  // Fetching the department name from the departments table
                    `)
                    .eq('jobId', jobId)  // Use the jobId to filter
                    .single();  // Ensures only one result is returned
        
                // Check if the job was found
                if (error || !job) {
                    console.error(`Job with ID ${jobId} not found.`);
                    req.flash('errors', { fetchError: 'Job not found.' });
                    return res.redirect('/hr/joboffers');  // Redirect if job is not found
                }
        
                console.log('Fetched Job:', job);  // Log the fetched job data
        
                // Fetch all job titles to populate the dropdown
                const { data: jobTitles, error: jobTitlesError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle')
                    .order('jobTitle', { ascending: true });
        
                if (jobTitlesError) {
                    console.error('Error fetching job titles:', jobTitlesError);
                    req.flash('errors', { fetchError: 'Error fetching job titles.' });
                    return res.redirect('/hr/joboffers');
                }
        
                // Fetch job skills
                const { data: jobSkills, error: jobSkillsError } = await supabase
                    .from('jobreqskills')
                    .select('*')
                    .eq('jobId', jobId);
        
                if (jobSkillsError) {
                    console.error('Error fetching job skills:', jobSkillsError);
                    req.flash('errors', { fetchError: 'Error fetching job skills.' });
                    return res.redirect('/hr/joboffers');
                }
        
                // Separate hard and soft skills
                const hardSkills = jobSkills.filter(skill => skill.jobReqSkillType === "Hard");
                const softSkills = jobSkills.filter(skill => skill.jobReqSkillType === "Soft");
        
                // Fetch job certifications
                const { data: certifications, error: certificationsError } = await supabase
                    .from('jobreqcertifications')
                    .select('jobReqCertificateType, jobReqCertificateDescrpt')
                    .eq('jobId', jobId);
        
                if (certificationsError) {
                    console.error('Error fetching job certifications:', certificationsError);
                    req.flash('errors', { fetchError: 'Error fetching job certifications.' });
                    return res.redirect('/hr/joboffers');
                }
        
                // Fetch job degrees
                const { data: degrees, error: degreesError } = await supabase
                    .from('jobreqdegrees')
                    .select('jobReqDegreeType, jobReqDegreeDescrpt')
                    .eq('jobId', jobId);
        
                if (degreesError) {
                    console.error('Error fetching job degrees:', degreesError);
                    req.flash('errors', { fetchError: 'Error fetching job degrees.' });
                    return res.redirect('/hr/joboffers');
                }
        
                // Fetch job experiences
                const { data: experiences, error: experiencesError } = await supabase
                    .from('jobreqexperiences')
                    .select('jobReqExperienceType, jobReqExperienceDescrpt')
                    .eq('jobId', jobId);
        
                if (experiencesError) {
                    console.error('Error fetching job experiences:', experiencesError);
                    req.flash('errors', { fetchError: 'Error fetching job experiences.' });
                    return res.redirect('/hr/joboffers');
                }
        
                // Render the job edit page with all the data
                res.render('staffpages/hr_pages/hreditjoboffers', { 
                    job, 
                    jobTitles, // Pass job titles to the template
                    hardSkills, 
                    softSkills, 
                    certifications, 
                    degrees, 
                    experiences
                });
        
            } catch (error) {
                console.error('Error fetching job offer:', error);
                req.flash('errors', { fetchError: 'Failed to fetch job offer.' });
                res.redirect('/hr/joboffers');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    
    
    

    getHRManageStaff: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Fetch data from Supabase
                const { data: staffAccounts, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select('staffId, userId, departmentId, jobId, lastName, firstName');
                if (staffError) throw staffError;
    
                const { data: userAccounts, error: userError } = await supabase
                    .from('useraccounts')
                    .select('userId, userEmail, userRole, userIsDisabled, userStaffOgPass');
                if (userError) throw userError;
    
                const { data: departments, error: deptError } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
                if (deptError) throw deptError;
    
                const { data: jobPositions, error: jobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, departmentId, jobTitle');
                if (jobError) throw jobError;
    
                // Map and combine staff data
                const staffList = await Promise.all(staffAccounts.map(async (staff) => {
                    const userAccount = userAccounts.find(user => user.userId === staff.userId);
                    const department = departments.find(dept => dept.departmentId === staff.departmentId);
                    const jobPosition = jobPositions.find(job => job.jobId === staff.jobId);
    
                    let jobTitle = jobPosition ? jobPosition.jobTitle : 'No job title assigned';
                    let userRole = userAccount ? userAccount.userRole : 'Unknown';
                    let deptName = department ? department.deptName : 'Unknown';
    
                    return {
                        deptName,
                        jobTitle,
                        lastName: staff.lastName,
                        firstName: staff.firstName,
                        userEmail: userAccount ? userAccount.userEmail : 'N/A',
                        userRole,
                        userStaffOgPass: userAccount ? userAccount.userStaffOgPass : 'N/A',
                        activeStatus: userAccount && userAccount.userIsDisabled ? 'Disabled' : 'Active'
                    };
                }));
    
                // Group staff by department
                const groupedByDept = departments.map(dept => ({
                    deptName: dept.deptName,
                    staff: staffList.filter(staff => staff.deptName === dept.deptName)
                }));
    
                // Pass grouped data to the EJS template
                const errors = req.flash('errors') || {};
                res.render('staffpages/hr_pages/hrmanagestaff', { errors, departments: groupedByDept });
            } catch (error) {
                console.error('Error fetching HR Manage Staff data:', error);
                req.flash('errors', { fetchError: 'Failed to fetch staff data. Please try again.' });
                res.redirect('/hr/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    getDepartments: async function(req, res) {
        try {
            const { data: departments, error: deptError } = await supabase
                .from('departments')
                .select('departmentId, deptName');
            if (deptError) throw deptError;
            res.json(departments);
        } catch (error) {
            console.error('Error fetching departments:', error);
            res.status(500).json({ error: 'Error fetching departments' });
        }
    },

    getJobTitles: async function(req, res) {
        const departmentId = req.query.departmentId;
        try {
            const { data: jobTitles, error: jobError } = await supabase
                .from('jobpositions')
                .select('jobId, jobTitle')
                .eq('departmentId', departmentId);
            if (jobError) throw jobError;
            res.json(jobTitles);
        } catch (error) {
            console.error('Error fetching job titles:', error);
            res.status(500).json({ error: 'Error fetching job titles' });
        }
    },

    getApplicantData: async function(req, res) {
        try {
            // Fetch applicants with their respective screening assessment data
            const { data: applicants, error: applicantError } = await supabase
                .from('applicantaccounts')
                .select(`
                    lastName, 
                    firstName, 
                    birthDate, 
                    phoneNo,
                    userId, 
                    applicant_initialscreening_assessment(
                        initialScreeningId,
                        jobId,
                        degreeScore,
                        experienceScore,
                        certificationScore,
                        hardSkillsScore,
                        softSkillsScore,
                        workSetupScore,
                        availabilityScore,
                        totalScore,
                        totalScoreCalculatedAt,
                         resume_url,
                        isHRChosen,
                        isLineManagerChosen
                    )
                `);
    
            if (applicantError) throw applicantError;
    
            // Render the EJS template and pass the applicants data
            res.render('staffpages/hr_pages/hrapplicanttracking-jobposition', { applicants });
    
        } catch (error) {
            console.error('Error fetching applicants:', error);
            res.status(500).json({ error: 'Error fetching applicants' });
        }
    },
    

    // Add a new department on the select picker on add new staff form
    addNewDepartment: async function(req, res) {
        const { deptName } = req.body;  // Assuming department name is sent in the body of the request
        try {
            // Insert new department
            const { data, error } = await supabase
                .from('departments')
                .insert([{ deptName }]); // Add department
            if (error) throw error;
            res.status(201).json({ message: 'New department added', department: data });
        } catch (error) {
            console.error('Error adding department:', error);
            res.status(500).json({ error: 'Error adding department' });
        }
    },
    
    // Add a new job title on the select picker on add new staff form
    addNewJobTitle: async function(req, res) {
        const { jobTitle, departmentId } = req.body; // Assuming jobTitle and departmentId are sent in the request body
        try {
            // Check if the job title already exists in the department
            const { data: existingJob, error: existingJobError } = await supabase
                .from('jobpositions')
                .select('jobId')
                .eq('jobTitle', jobTitle)
                .eq('departmentId', departmentId);
    
            if (existingJobError) throw existingJobError;
    
            if (existingJob && existingJob.length > 0) {
                // If the job title already exists, return the jobId
                return res.status(200).json({ message: 'Job title already exists', jobId: existingJob[0].jobId });
            }
    
            // If the job title does not exist, insert a new record
            const { data: newJob, error: newJobError } = await supabase
                .from('jobpositions')
                .insert([{ jobTitle, departmentId }])
                .select();
    
            if (newJobError) throw newJobError;
    
            return res.status(201).json({ message: 'New job title added', jobId: newJob[0].jobId });
        } catch (error) {
            console.error('Error adding job title:', error);
            return res.status(500).json({ error: 'Error adding job title' });
        }
    },
    

    
    getAddStaffForm: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { data: departments, error: deptError } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
                if (deptError) throw deptError;

                const { data: jobPositions, error: jobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle, departmentId');
                if (jobError) throw jobError;

                const jobPositionsByDept = {};
                departments.forEach(dept => {
                    jobPositionsByDept[dept.departmentId] = jobPositions.filter(
                        job => job.departmentId === dept.departmentId
                    );
                });

                res.render('staffpages/hr_pages/addstaff', { 
                    departments, 
                    jobPositionsByDept
                });
            } catch (error) {
                console.error('Error fetching data for Add Staff form:', error);
                req.flash('errors', { fetchError: 'Failed to load form data. Please try again.' });
                res.redirect('/hr/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    addNewStaff: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            const { departmentId, jobId, lastName, firstName, email, role, passwordOption, customPassword, generatedPassword } = req.body;
    
            console.log('Request Body:', req.body);
            console.log('Password Option:', passwordOption);
            console.log('Custom Password:', customPassword);
            console.log('Generated Password:', generatedPassword);
    
            try {
                // Handle password option
                let password;
                if (passwordOption === 'custom') {
                    password = customPassword;
                } else if (passwordOption === 'random') {  // Corrected this line
                    password = generatedPassword;
                } else {
                    throw new Error('Invalid password option');
                }
    
                // Check if password is provided
                if (!password) {
                    throw new Error('Password is required');
                }
    
                console.log('Password before hashing:', password);
    
                // Hash the password
                const hashedPassword = await bcrypt.hash(password, 10);
                console.log('Hashed Password:', hashedPassword);
    
                // Insert into useraccounts table
                const { data: userData, error: userError } = await supabase
                    .from('useraccounts')
                    .insert([{
                        userPass: hashedPassword,
                        userRole: role,
                        userIsDisabled: false,
                        userEmail: email,
                        userStaffOgPass: password // Store the actual password
                    }])
                    .select()
                    .single();
    
                if (userError) {
                    console.error('User Insert Error:', userError);
                    throw userError;
                }
    
                const userId = userData.userId;
    
                // Insert into staffaccounts table
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .insert([{
                        userId,
                        departmentId,
                        jobId,
                        lastName,
                        firstName
                    }])
                    .select()
                    .single();
    
                if (staffError) {
                    console.error('Staff Insert Error:', staffError);
                    throw staffError;
                }
    
                res.status(200).json({ message: 'Staff added successfully.' });
                console.log('Staff data:', staffData);
    
            } catch (error) {
                console.error('Error adding staff:', error.message);
                res.status(500).json({ error: `Error adding staff. Please try again. ${error.message}` });
            }
        } else {
            res.status(403).json({ error: 'Unauthorized access' });
        }
    },

    // Leave Request functionality
    getLeaveRequestForm: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const leaveTypes = [
                    { leaveTypeId: 1, typeName: 'Sick Leave' },
                    { leaveTypeId: 2, typeName: 'Vacation Leave' },
                    { leaveTypeId: 3, typeName: 'Emergency Leave' },
                    { leaveTypeId: 4, typeName: 'Maternity Leave' },
                    { leaveTypeId: 5, typeName: 'Paternity Leave' }
                ];
                
                res.render('staffpages/hr_pages/hrleaverequest', { leaveTypes });
            } catch (error) {
                console.error('Error rendering leave request form:', error);
                req.flash('error', { fetchError: 'Unable to load leave request form.' });
                return res.redirect('/staff/login');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
            res.redirect('/staff/login');
        }
    },

    updateApplicantIsChosen: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { lastName, firstName } = req.body; // Extract applicant details from the request
    
                // Use a switch case to handle the update logic
                switch (true) {
                    case !lastName || !firstName: {
                        console.error('Missing applicant details.');
                        return res.status(400).json({ success: false, message: 'Applicant details are missing.' });
                    }
    
                    case true: {
                        // Case to update `isChosen1` field
                        const { error: chosenError } = await supabase
                            .from('applicantaccounts')
                            .update({ isChosen1: true })
                            .match({ lastName, firstName });
    
                        if (chosenError) {
                            console.error('Error updating isChosen1:', chosenError);
                            return res.status(500).json({ success: false, message: 'Failed to update isChosen1.' });
                        }
    
                        // Case to update `applicantStatus` after `isChosen1` is true
                        const { error: statusError } = await supabase
                            .from('applicantaccounts')
                            .update({ applicantStatus: 'P1 - Awaiting for Line Manager Action; HR PASSED' })
                            .match({ lastName, firstName, isChosen1: true });
    
                        if (statusError) {
                            console.error('Error updating applicantStatus:', statusError);
                            return res.status(500).json({ success: false, message: 'Failed to update applicant status.' });
                        }
    
                        // If all updates succeed
                        return res.json({ success: true, message: 'Applicant status updated successfully.' });
                    }
    
                    default: {
                        console.error('Unexpected case encountered.');
                        return res.status(400).json({ success: false, message: 'Invalid operation.' });
                    }
                }
            } catch (error) {
                console.error('Error in updateApplicantIsChosen:', error);
                res.status(500).json({ success: false, message: 'Internal server error.' });
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
            res.redirect('/staff/login');
        }
    },


    saveEvaluation: async function (req, res) {
        try {
            // Destructure required fields from the request body
            console.log("Request Body:", req.body);
            const { applicantId, totalRating } = req.body;
    
            // Validate required inputs
            if (!applicantId || !totalRating) {
                return res.status(400).json({
                    success: false,
                    message: "Applicant ID and total rating are required.",
                });
            }
    
            // Convert `applicantId` to an integer (if applicable)
            const parsedApplicantId = parseInt(applicantId, 10);
            if (isNaN(parsedApplicantId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid Applicant ID format.",
                });
            }
    
            // Save the evaluation score to the database
            const { data, error } = await supabase
                .from("applicantaccounts")
                .update({ hrInterviewFormScore: totalRating }) // Assuming the column exists
                .eq("applicantId", parsedApplicantId); // Match on the applicantId column

            console.log("Supabase Response:", { data, error });

            // Check for Supabase errors
            if (error) {
                console.error("Error saving evaluation score:", data, error);
                return res.status(500).json({
                    success: false,
                    message: "Failed to save the evaluation score.",
                });
            }
    
            // Respond with success
            res.json({
                success: true,
                message: "Evaluation score saved successfully!",
            });
        } catch (err) {
            // Handle unexpected server errors
            console.error("Server error:", err);
            res.status(500).json({
                success: false,
                message: "An unexpected error occurred while saving the evaluation.",
            });
        }
    },
    
    
    
    submitLeaveRequest: async function (req, res) {
        if (!req.session.user || !req.session.user.userId) {
            return res.status(401).json({ message: 'Unauthorized access' });
        }
    
        const { leaveType, dayType, reason, fromDate, toDate, halfDayDate, startTime, endTime } = req.body;
    
        if (!leaveType || !dayType || !reason) {
            return res.status(400).json({ message: 'Leave type, day type, and reason are required.' });
        }
    
        try {
            const { error } = await supabase
                .from('leave_requests')
                .insert([
                    {
                        userId: req.session.user.userId, 
                        leaveType,
                        dayType,
                        reason,
                        fromDate,
                        toDate,
                        halfDayDate,
                        startTime,
                        endTime,
                        status: 'Pending for Approval', 
                        submittedAt: new Date()
                    }
                ]);
    
            if (error) throw error;
    
            res.status(200).json({ message: 'Leave request submitted successfully' });
        } catch (error) {
            console.error('Error submitting leave request:', error);
            res.status(500).json({ message: 'Internal server error', error: error.message });
        }
    }, 

    
    //TODO: Backend for career progression onwards - ongoing, will prio objective and performance review tracker (charisse)
    getRecordsPerformanceTracker: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                console.log("Fetching performance tracker records...");
        
                // Fetch staff-related data
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select(`
                        staffId, 
                        userId, 
                        departmentId, 
                        jobId, 
                        lastName, 
                        firstName,
                        useraccounts (
                            userId, 
                            userEmail
                        ),
                        departments (
                            deptName
                        ),
                        jobpositions (
                            jobTitle
                        )
                    `)
                    .order('lastName', { ascending: true });
        
                if (staffError) throw staffError;
        
                console.log("Staff data fetched successfully:", staffData);
        
                // Fetch job-related data (job requirements)
                const { data: jobReqCertifications, error: certificationsError } = await supabase
                    .from('jobreqcertifications')
                    .select(`
                        jobId,
                        jobReqCertificateId,
                        jobReqCertificateDescrpt,
                        jobReqCertificateType
                    `);
        
                if (certificationsError) throw certificationsError;
        
                const { data: jobReqDegrees, error: degreesError } = await supabase
                    .from('jobreqdegrees')
                    .select(`
                        jobId,
                        jobReqDegreeId,
                        jobReqDegreeType,
                        jobReqDegreeDescrpt
                    `);
        
                if (degreesError) throw degreesError;
        
                const { data: jobReqExperiences, error: experiencesError } = await supabase
                    .from('jobreqexperiences')
                    .select(`
                        jobId,
                        jobReqExperienceId,
                        jobReqExperienceType,
                        jobReqExperienceDescrpt
                    `);
        
                if (experiencesError) throw experiencesError;
        
                const { data: jobReqSkills, error: skillsError } = await supabase
                    .from('jobreqskills')
                    .select(`
                        jobId,
                        jobReqSkillId,
                        jobReqSkillType,
                        jobReqSkillName
                    `);
        
                if (skillsError) throw skillsError;
        
                // Map fetched data to a structured employee list grouped by department
                const departmentMap = staffData.reduce((acc, staff) => {
                    const deptName = staff.departments?.deptName || 'Unknown';
                    if (!acc[deptName]) {
                        acc[deptName] = [];
                    }
        
                    // Find job requirements by matching jobId
                    const jobReqCertificationsByJob = jobReqCertifications.filter(cert => cert.jobId === staff.jobId);
                    const jobReqDegreesByJob = jobReqDegrees.filter(degree => degree.jobId === staff.jobId);
                    const jobReqExperiencesByJob = jobReqExperiences.filter(experience => experience.jobId === staff.jobId);
                    const jobReqSkillsByJob = jobReqSkills.filter(skill => skill.jobId === staff.jobId);
        
                    // Check if any job requirements are missing
                    const isJobRequirementsMissing = !(jobReqCertificationsByJob.length > 0 &&
                        jobReqDegreesByJob.length > 0 &&
                        jobReqExperiencesByJob.length > 0 &&
                        jobReqSkillsByJob.length > 0);
        
                    acc[deptName].push({
                        userId: staff.userId,
                        jobTitle: staff.jobpositions?.jobTitle || 'No job title assigned',
                        lastName: staff.lastName,
                        firstName: staff.firstName,
                        userEmail: staff.useraccounts?.userEmail || 'N/A',
                        isJobRequirementsMissing,  // Flag indicating missing job requirements
                        hasJobRequirements: !isJobRequirementsMissing,  // Flag for existing job requirements
                        jobId: staff.jobId,
                        jobReqCertifications: jobReqCertificationsByJob,
                        jobReqDegrees: jobReqDegreesByJob,
                        jobReqExperiences: jobReqExperiencesByJob,
                        jobReqSkills: jobReqSkillsByJob
                    });
                    return acc;
                }, {});
        
                // Render the data in the view
                res.render('staffpages/hr_pages/hrrecordsperftracker', { departments: departmentMap });
        
            } catch (error) {
                console.error("Error fetching performance tracker data:", error);
                res.status(500).send("Error fetching performance tracker data");
            }
        } else {
            res.redirect('/login');
        }
    },
      
    
    getRecordsPerformanceTrackerByUserId: async function(req, res) {
        try {
            const userId = req.params.userId;  // Retrieve userId from URL params
            console.log('Fetching records for userId:', userId);
    
            if (!userId) {
                req.flash('errors', { authError: 'User not logged in.' });
                return res.redirect('/staff/login');
            }
    
            // Single query to fetch all user-related data
            const { data: userData, error } = await supabase
                .from('useraccounts')
                .select(`
                    userEmail, 
                    userRole, 
                    staffaccounts (
                        firstName, 
                        lastName, 
                        phoneNumber, 
                        dateOfBirth, 
                        emergencyContactName, 
                        emergencyContactNumber, 
                        employmentType, 
                        hireDate, 
                        staffId, 
                        jobId,
                        departmentId,
                        departments (
                            deptName
                        ),
                        jobpositions (
                            jobTitle
                        ),
                        staffdegrees (
                            degreeName, 
                            universityName, 
                            graduationYear
                        ),
                        staffcareerprogression (
                            milestoneName, 
                            startDate, 
                            endDate
                        ),
                        staffexperiences (
                            companyName, 
                            startDate
                        ),
                        staffcertification!staffcertification_staffId_fkey (
                            certificateName, 
                            certDate
                        )
                    )
                `)
                .eq('userId', userId)
                .single();
    
            if (error) throw error;
    
            console.log('Fetched user data:', userData);
    
            // Compile the userData into the format required for the template
            const formattedUserData = {
                userEmail: userData.userEmail || '',
                userRole: userData.userRole || '',
                // Accessing the first item in the staffaccounts array
                firstName: userData.staffaccounts[0]?.firstName || '',
                lastName: userData.staffaccounts[0]?.lastName || '',
                phoneNumber: userData.staffaccounts[0]?.phoneNumber || '',
                dateOfBirth: userData.staffaccounts[0]?.dateOfBirth || '',
                emergencyContactName: userData.staffaccounts[0]?.emergencyContactName || '',
                emergencyContactNumber: userData.staffaccounts[0]?.emergencyContactNumber || '',
                employmentType: userData.staffaccounts[0]?.employmentType || '',
                hireDate: userData.staffaccounts[0]?.hireDate || '',
                jobTitle: userData.staffaccounts[0]?.jobpositions?.jobTitle || '',
                departmentName: userData.staffaccounts[0]?.departments?.deptName || '',
                milestones: userData.staffaccounts[0]?.staffcareerprogression || [],
                degrees: userData.staffaccounts[0]?.staffdegrees || [],
                experiences: userData.staffaccounts[0]?.staffexperiences || [],
                certifications: userData.staffaccounts[0]?.staffcertification || []
            };
    
            console.log('Compiled user data:', formattedUserData);
    
            res.render('staffpages/hr_pages/hrrecordsperftracker-user', {
                user: formattedUserData,
                errors: req.flash('errors')
            });
        } catch (err) {
            console.error('Error in getRecordsPerformanceTrackerByUserId controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the personal info page.' });
            res.redirect('staffpages/hr_pages/hrrecordsperftracker');
        }
    },

    //ARCHIVED
    // getApplicantTracking: async function (req, res) {
    //     if (!req.session.user) {
    //         req.flash('errors', { authError: 'Unauthorized. Access only for authorized users.' });
    //         return res.redirect('/staff/login');
    //     }
    
    //     try {
    //         const { data: applicants, error } = await supabase
    //             .from('applicantaccounts')
    //             .select('applicantId, firstName, lastName, userId, created_at') 
    //             .order('created_at', { ascending: false }); 
    
    //         if (error) {
    //             console.error('Error fetching applicants:', error);
    //             return res.status(500).send('Error fetching applicants');
    //         }
    
    //         for (let applicant of applicants) {
    //             const { data: chatbotResponses, error: chatbotError } = await supabase
    //                 .from('chatbot_interaction')
    //                 .select('message, response, applicantStage')
    //                 .eq('userId', applicant.userId)
    //                 .order('timestamp', { ascending: true });
    
    //             if (chatbotError) {
    //                 console.error('Error fetching chatbot responses:', chatbotError);
    //                 return res.status(500).send('Error fetching chatbot responses');
    //             }
    
    //             // Find the position applied from the chatbot messages
    //             const positionAppliedMessage = chatbotResponses.find(response => response.message.toLowerCase().includes("position applied"));
    //             applicant.positionApplied = positionAppliedMessage ? positionAppliedMessage.message.split(":")[1].trim() : "N/A";  // Extract position after the colon
    
    //             // Find the application status based on the applicantStage
    //             const applicationStatusMessage = chatbotResponses.find(response => response.applicantStage === "application_complete" || response.applicantStage === "final_status");
    //             applicant.applicationStatus = applicationStatusMessage ? "Completed" : "Pending";  // Assuming 'Completed' if found, otherwise 'Pending'
    //         }
    
    //         res.render('staffpages/hr_pages/applicant-tracking-system', { applicants });
    
    //     } catch (error) {
    //         console.error('Error:', error);
    //         return res.status(500).send('Error fetching applicants');
    //     }
    // },        

    
    
    getOffboardingRequestsDash: async function (req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
    
            if (!userId || req.session.user.userRole !== 'HR') { 
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            console.log('Fetching offboarding requests for HR dashboard');
    
            // Fetch offboarding requests with userId and status - include ALL relevant statuses
            const { data: requests, error: requestsError } = await supabase
                .from('offboarding_requests')
                .select('requestId, userId, message, last_day, status, created_at')
                .in('status', ['Pending HR', 'Sent to Employee', 'Completed by Employee'])
                .order('created_at', { ascending: false });
    
            if (requestsError) {
                console.error('Error fetching offboarding requests:', requestsError);
                req.flash('errors', { dbError: 'Failed to load offboarding requests.' });
                return res.redirect('/hr/dashboard');
            }
    
            console.log(`Found ${requests ? requests.length : 0} offboarding requests`);
            
            if (requests && requests.length > 0) {
                console.log('Statuses found:', requests.map(r => r.status));
            }
    
            // Fetch employee names and department names based on userId
            const userIds = requests.map(request => request.userId);
            const { data: staffAccounts, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, firstName, lastName, departmentId, departments (deptName)')
                .in('userId', userIds);  // Fetch staff details for each userId
    
            if (staffError) {
                console.error('Error fetching staff accounts:', staffError);
                req.flash('errors', { dbError: 'Failed to load employee names.' });
                return res.redirect('/hr/dashboard');
            }
    
            // Combine offboarding requests with staff details and department names
            const requestsWithNames = requests.map(request => {
                const staff = staffAccounts.find(staff => staff.userId === request.userId);
                return {
                    ...request,
                    staffName: staff ? `${staff.firstName} ${staff.lastName}` : 'Unknown',
                    department: staff ? staff.departments.deptName : 'Unknown'
                };
            });
    
            console.log('Rendering HR dashboard with requests');
            res.render('staffpages/hr_pages/offboardingrequest', { requests: requestsWithNames });
        } catch (err) {
            console.error('Error in getOffboardingRequestsDash controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading offboarding requests.' });
            res.redirect('/hr/dashboard');
        }
    },

    getViewOffboardingRequest: async function (req, res) {
        const userId = req.params.userId;
    
        if (!userId) {
            return res.redirect('/staff/login');
        }
    
        try {
            // Fetch offboarding request
            const { data: requests, error: requestError } = await supabase
                .from('offboarding_requests')
                .select('requestId, userId, offboardingType, reason, message, last_day, status, created_at, line_manager_notes, line_manager_decision')
                .eq('userId', userId)
                .order('created_at', { ascending: false })
                .limit(1);
    
            if (requestError) {
                console.error('Error fetching offboarding request:', requestError);
                return res.redirect('/hr/dashboard');
            }
    
            if (!requests || requests.length === 0) {
                console.log('No offboarding request found for userId:', userId);
                return res.redirect('/hr/dashboard');
            }
    
            const requestId = requests[0].requestId;
    
            // Fetch checklist for the request
            const { data: checklistData, error: checklistError } = await supabase
                .from('offboarding_checklist')
                .select('checklist_items, created_at')
                .eq('requestId', requestId)
                .single();
    
            if (checklistError && checklistError.code !== 'PGRST116') { // Ignore "No rows found" error
                console.error('Error fetching checklist:', checklistError);
                return res.redirect('/hr/dashboard');
            }
    
            // Fetch staff details
            const { data: staff } = await supabase
                .from('staffaccounts')
                .select('firstName, lastName, departmentId, departments (deptName)')
                .eq('userId', userId)
                .single();
    
            res.render('staffpages/hr_pages/viewoffboardingrequest', {
                request: requests[0],
                staffName: `${staff.firstName} ${staff.lastName}`,
                department: staff.departments.deptName,
                checklist: checklistData ? checklistData.checklist_items : [], // Pass checklist items
                checklistCreatedAt: checklistData ? checklistData.created_at : null // Pass checklist creation date
            });
        } catch (err) {
            console.error('Error in getViewOffboardingRequest controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the offboarding request.' });
            return res.redirect('/hr/dashboard');
        }
    },
    
    saveChecklist: async function (req, res) {
        try {
            const { requestId, checklist } = req.body;
            console.log("Received for saving:", { requestId, checklist });
    
            if (!requestId || !Array.isArray(checklist)) {
                return res.status(400).json({ error: "Invalid request data." });
            }
    
            // Check if a checklist already exists for this request
            const { data: existingChecklist, error: fetchError } = await supabase
                .from("offboarding_checklist")
                .select("checklistId")
                .eq("requestId", requestId)
                .single();
    
            if (fetchError && fetchError.code !== 'PGRST116') { // Ignore "No rows found" error
                console.error("Error fetching existing checklist:", fetchError);
                return res.status(500).json({ error: "Failed to fetch existing checklist." });
            }
    

            let error;

            if (existingChecklist) {
                const { error: updateError } = await supabase
                    .from("offboarding_checklist")
                    .update({
                        checklist_items: checklist,
                        created_at: new Date().toISOString()
                    })
                    .eq("checklistId", existingChecklist.checklistId);

                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from("offboarding_checklist")
                    .insert({
                        requestId: requestId,
                        checklist_items: checklist,
                        created_at: new Date().toISOString()
                    });

                    error = insertError;

            }
                
            if (error) {
                console.error("Error saving checklist:", error);
                return res.status(500).json({ error: "Failed to save checklist." });
            }
    
            res.json({ success: true, message: "Checklist saved successfully!" });
        } catch (err) {
            console.error("Error in saveChecklist controller:", err);
            res.status(500).json({ error: "An error occurred while saving the checklist." });
        }
    },

    sendClearanceToEmployee: async function (req, res) {
        try {
            const { requestId } = req.body;
    
            if (!requestId) {
                return res.status(400).json({ error: "Invalid request data." });
            }
    
            // Update the offboarding_request status to "Sent to Employee"
            const { data, error } = await supabase
                .from("offboarding_requests")
                .update({ 
                    status: "Sent to Employee",
                    clearance_sent_date: new Date().toISOString()
                })
                .eq("requestId", requestId)
                .select();
    
            if (error) {
                console.error("Error sending clearance to employee:", error);
                return res.status(500).json({ error: "Failed to send clearance to employee." });
            }
    
            res.json({ success: true, message: "Clearance sent to employee successfully!", data });
        } catch (err) {
            console.error("Error in sendClearanceToEmployee controller:", err);
            res.status(500).json({ error: "An error occurred while sending the clearance." });
        }
    },

    approveOffboarding: async function (req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            const { requestId } = req.body;
            
            if (!userId || req.session.user.userRole !== 'HR') { 
                return res.status(401).json({ 
                    success: false, 
                    error: 'Unauthorized access.' 
                });
            }
            
            if (!requestId) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Request ID is required.' 
                });
            }
            
            console.log(`Approving offboarding request ID: ${requestId} by HR user ID: ${userId}`);
            
            // Verify that the request exists and is in the correct status
            const { data: request, error: requestError } = await supabase
                .from('offboarding_requests')
                .select('status')
                .eq('requestId', requestId)
                .single();
                
            if (requestError) {
                console.error('Error fetching offboarding request:', requestError);
                return res.status(404).json({ 
                    success: false, 
                    error: 'Request not found.' 
                });
            }
            
            if (!request) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Request not found.' 
                });
            }
            
            if (request.status !== 'Completed by Employee') {
                return res.status(400).json({ 
                    success: false, 
                    error: 'This request cannot be approved in its current status.' 
                });
            }
            
            // Update the request status to "Completed"
            const { data: updateData, error: updateError } = await supabase
                .from('offboarding_requests')
                .update({ 
                    status: 'Completed',
                    hr_decision_date: new Date().toISOString()
                })
                .eq('requestId', requestId)
                .select();
                
            if (updateError) {
                console.error('Error updating request status:', updateError);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Failed to approve offboarding request.' 
                });
            }
            
            console.log('Offboarding request approved successfully:', updateData);
            
            return res.json({ 
                success: true, 
                message: 'Offboarding request approved successfully.' 
            });
        } catch (err) {
            console.error('Error in approveOffboarding controller:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'An error occurred while processing the request.' 
            });
        }
    },
    
    getRetirementTracker: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                console.log("Fetching retirement tracker data...");

                // Fetch staff-related data, including dateOfBirth and hireDate
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select(`
                        staffId, 
                        userId, 
                        departmentId, 
                        jobId, 
                        lastName, 
                        firstName,
                        dateOfBirth,  
                        hireDate,
                        useraccounts (
                            userId, 
                            userEmail
                        ),
                        departments (
                            deptName
                        ),
                        jobpositions (
                            jobTitle
                        )
                    `)
                    .order('lastName', { ascending: true });

                if (staffError) throw staffError;

                console.log("Staff data fetched successfully:", staffData);

                // Calculate years of service and categorize employees based on retirement eligibility
                const departmentMap = staffData.reduce((acc, staff) => {
                    const deptName = staff.departments?.deptName || 'Unknown';
                    
                    // Handle potential null/undefined values for dates
                    let yearsOfService = null;
                    let age = null;
                    let birthDate = null;

                    // Process hire date if available
                    if (staff.hireDate) {
                        const hireDate = new Date(staff.hireDate);
                        const currentDate = new Date();
                        
                        // Only calculate if the date is valid
                        if (!isNaN(hireDate.getTime())) {
                            yearsOfService = currentDate.getFullYear() - hireDate.getFullYear();
                            
                            // Adjust for hire date not yet reached this year
                            const hireMonth = hireDate.getMonth();
                            const currentMonth = currentDate.getMonth();
                            
                            if (currentMonth < hireMonth || 
                                (currentMonth === hireMonth && currentDate.getDate() < hireDate.getDate())) {
                                yearsOfService--;
                            }
                        }
                    }

                    // Process birth date if available
                    if (staff.dateOfBirth) {
                        birthDate = new Date(staff.dateOfBirth);
                        const today = new Date();
                        
                        // Only calculate if the date is valid
                        if (!isNaN(birthDate.getTime())) {
                            age = today.getFullYear() - birthDate.getFullYear();
                            
                            // Adjust for birthday not yet reached this year
                            const birthMonth = birthDate.getMonth();
                            const currentMonth = today.getMonth();
                            
                            if (currentMonth < birthMonth || 
                                (currentMonth === birthMonth && today.getDate() < birthDate.getDate())) {
                                age--;
                            }
                        }
                    }

                    // Determine retirement eligibility (combine age and years of service criteria)
                    // Standard rule: Age 60+ with 5+ years of service, or 30+ years of service at any age
                    let retirementEligibility = 'Not Eligible';
                    if ((age !== null && age >= 60 && yearsOfService !== null && yearsOfService >= 5) || 
                        (yearsOfService !== null && yearsOfService >= 30)) {
                        retirementEligibility = 'Eligible for Retirement';
                    }
                    
                    if (!acc[deptName]) {
                        acc[deptName] = [];
                    }

                    acc[deptName].push({
                        userId: staff.userId,
                        jobTitle: staff.jobpositions?.jobTitle || 'No job title assigned',
                        lastName: staff.lastName,
                        firstName: staff.firstName,
                        userEmail: staff.useraccounts?.userEmail || 'N/A',
                        birthDate: birthDate, // Renamed to match template
                        hireDate: staff.hireDate,
                        age: age, // Added calculated age
                        yearsOfService: yearsOfService,
                        retirementEligibility: retirementEligibility
                    });
                    return acc;
                }, {});

                // Render the data in the view
                res.render('staffpages/hr_pages/hr-retirement-tracker', { departments: departmentMap });

            } catch (error) {
                console.error("Error fetching retirement tracker data:", error);
                res.status(500).send("Error fetching retirement tracker data");
            }
        } else {
            res.redirect('/login');
        }
    },
    
    getLogoutButton: function(req, res) {
        req.session.destroy(err => {
            if(err) {
                console.error('Error destroying session', err);
                return res.status(500).json({ error: 'Failed to log out. Please try again.' });
            }
            res.redirect('/staff/login');
        });
    },



    /* NOTIFICATION CONTROLLER */


    get360FeedbackToast: async function(req, res) {
        try {
            console.log("Entering get360FeedbackToast function");
    
            // Step 1: Get today's date in the Philippines Time Zone (PHT) and format it to 'YYYY-MM-DD'
            const today = new Date();
            const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
            const formatter = new Intl.DateTimeFormat('en-US', options);
            const parts = formatter.formatToParts(today);
    
            const todayString = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`;
    
            const feedbackTables = ['feedbacks_Q1', 'feedbacks_Q2', 'feedbacks_Q3', 'feedbacks_Q4']; // List of feedback tables
            let activeFeedback = null;
    
            // Step 2: Fetch the current user's department ID
            const currentUserId = req.session?.user?.userId;
    
            if (!currentUserId) {
                console.error("Error: No user ID available in session.");
                return res.status(400).json({ success: false, message: 'User ID is required.' });
            }
    
            const { data: currentUserData, error: userError } = await supabase
                .from('staffaccounts')
                .select('departmentId')
                .eq('userId', currentUserId)
                .single();
    
            if (userError || !currentUserData) {
                console.error("Error fetching user details:", userError);
                return res.status(404).json({ success: false, message: 'User details not found.' });
            }
    
            const { departmentId } = currentUserData;
    
            // Step 3: Loop through each feedback table (Q1 to Q4) and fetch the active feedback record
            for (const feedbackTable of feedbackTables) {
                console.log(`Fetching data from table: ${feedbackTable}...`);
    
                const { data, error } = await supabase
                    .from(feedbackTable)
                    .select('*')
                    .lte('setStartDate', todayString) // Changed from gte to lte to ensure we get records starting today or earlier
                    .gte('setEndDate', todayString);  // Changed from gt to gte to include today's date
    
                if (error) {
                    console.error(`Error fetching data from ${feedbackTable}:`, error);
                    continue; // Skip to the next table if there's an error with the current table
                }
    
                // Check if data is found and set activeFeedback
                if (data && data.length > 0) {
                    console.log(`Data fetched from ${feedbackTable}:`, data);
    
                    // Step 4: Filter userIds to only include those in the same department
                    const departmentUserIds = [];
    
                    for (const record of data) {
                        const { data: userData, error: userFetchError } = await supabase
                            .from('staffaccounts')
                            .select('departmentId')
                            .eq('userId', record.userId)
                            .single();
    
                        if (userFetchError || !userData) {
                            console.error("Error fetching user details:", userFetchError);
                            continue; // Skip if there's an error
                        }
    
                        if (userData.departmentId === departmentId) {
                            departmentUserIds.push(record); // Store the entire record if the department matches
                        }
                    }
    
                    if (departmentUserIds.length > 0) {
                        activeFeedback = departmentUserIds[0]; // Assuming only one active feedback per table
                        // Also store the table name so we know which quarter it belongs to
                        activeFeedback.sourceTable = feedbackTable;
                        break; // Stop searching once an active feedback is found
                    } else {
                        console.log(`No active feedback found for the current user's department in ${feedbackTable}.`);
                    }
                } else {
                    console.log(`No data found in ${feedbackTable}.`);
                }
            }
    
            // Ensure the logic is correct for date matching
            console.log(`Today's Date: ${todayString}`);
            console.log('Active Feedback Record:', activeFeedback);
    
            // Step 5: Check if any active feedback record was found
            if (!activeFeedback) {
                console.log('No active feedback records found for the given date range.');
                return res.status(404).json({ 
                    success: false, 
                    message: 'No active feedback records found for the given date range.' 
                });
            }
    
            // Step 6: Determine quarter from the source table
            let quarter;
            if (activeFeedback.sourceTable === 'feedbacks_Q1') quarter = 'Q1';
            else if (activeFeedback.sourceTable === 'feedbacks_Q2') quarter = 'Q2';
            else if (activeFeedback.sourceTable === 'feedbacks_Q3') quarter = 'Q3';
            else if (activeFeedback.sourceTable === 'feedbacks_Q4') quarter = 'Q4';
            else quarter = activeFeedback.quarter || ''; // Fallback to stored quarter if available
    
            // Return the active feedback record with additional user ID for the frontend
            return res.status(200).json({ 
                success: true, 
                feedback: activeFeedback, 
                quarter,
                userId: currentUserId
            });
    
        } catch (error) {
            console.error('Error in get360FeedbackToast:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'An error occurred while fetching feedback data.', 
                error: error.message 
            });
        }
    },
    
    
    
};


module.exports = hrController;
