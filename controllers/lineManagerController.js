const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const { getISOWeek } = require('date-fns');


async function getLeaveTypeName(leaveTypeId) {
    try {
        // Query the leave types table to get the name
        const { data, error } = await supabase
            .from('leavetypes')
            .select('leaveTypeName')
            .eq('leaveTypeId', leaveTypeId)
            .single();
            
        if (error || !data) {
            console.log('Error getting leave type name:', error);
            return 'Leave';
        }
        
        return data.leaveTypeName || 'Leave';
    } catch (err) {
        console.error('Error in getLeaveTypeName:', err);
        return 'Leave';
    }
}
function isValidQuarter(quarter) {
    return ['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter);
}

const lineManagerController = {
    

    //TODO: should display all approved leave requests of the day - current sol here is not the current date
    // ++ should arrange this part by respective department 
    getLineManagerDashboard: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
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
                        userId: leave.userId,
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
    
                // Function to fetch attendance logs
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
    
                // Fetch applicant statuses for line manager actions
                const fetchPendingApprovals = async () => {
                    const { data, error } = await supabase
                        .from('applicantaccounts')
                        .select('applicantStatus')
                        .eq('applicantStatus', 'P1 - Awaiting for Line Manager Action; HR PASSED');
    
                    if (error) throw error;
    
                    return data.length > 0 ? 'P1 - Awaiting for Line Manager Action; HR PASSED' : null;
                };
    
                // ✅ Fetch notifications
                const fetchNotifications = async () => {
                    const { data: applicants, error } = await supabase
                        .from('applicantaccounts')
                        .select('firstName, lastName, applicantStatus, created_at')
                        .order('created_at', { ascending: false });
    
                    if (error) {
                        console.error('Error fetching notifications:', error);
                        throw new Error('Error retrieving notifications.');
                    }
    
                    return applicants.map(applicant => ({
                        firstName: applicant.firstName,
                        lastName: applicant.lastName,
                        applicantStatus: applicant.applicantStatus,
                        date: applicant.created_at,
                        employeePhoto: "/images/profile.png", // Placeholder image
                        headline: applicant.applicantStatus === "P1 - Awaiting for Line Manager Action; HR PASSED"
                            ? "Awaiting Your Approval"
                            : "New Application Received",
                        content: applicant.applicantStatus === "P1 - Awaiting for Line Manager Action; HR PASSED"
                            ? `Required Line Manager Action for ${applicant.firstName} ${applicant.lastName}`
                            : `${applicant.firstName} ${applicant.lastName} submitted an application.`
                    }));
                };
    
                // Function to format attendance logs
                const formatAttendanceLogs = (attendanceLogs, selectedDate = null) => {
                    const filterDate = selectedDate || new Date().toISOString().split('T')[0];
                
                    const formattedAttendanceLogs = attendanceLogs
                        .filter(attendance => attendance.attendanceDate === filterDate) 
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
    
                // ✅ Fetch data
                const formattedAllLeaves = await fetchAndFormatLeaves();
                const formattedApprovedLeaves = await fetchAndFormatLeaves('Approved');
                const attendanceLogs = await fetchAttendanceLogs();
                const pendingApprovalStatus = await fetchPendingApprovals();
                const formattedAttendanceDisplay = formatAttendanceLogs(attendanceLogs);
                const notifications = await fetchNotifications(); // ✅ Notifications
    
                // ✅ Render with notifications
                return res.render('staffpages/linemanager_pages/managerdashboard', { 
                    allLeaves: formattedAllLeaves || [],
                    approvedLeaves: formattedApprovedLeaves || [],
                    pendingApprovalStatus: pendingApprovalStatus || '',
                    attendanceLogs: formattedAttendanceDisplay || [],
                    notifications: notifications || [], 
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors')
                });
    
            } catch (err) {
                console.error('Error fetching data for the dashboard:', err);
                req.flash('errors', { dbError: 'An error occurred while loading the dashboard.' });
                return res.redirect('/linemanager/dashboard');
            }
        } else {
            return res.redirect('/staff/login');
        }
    },
    

    // // Updated Line Manager Controller function to fetch applicant notifications

    // getLineManagerNotifications: async function (req, res) {
    //     // Check for authentication
    //     if (!req.session.user) {
    //         return res.status(401).json({ error: 'Unauthorized' });
    //     }
    
    //     try {
    //         // Get the line manager's department ID first
    //         const lineManagerId = req.session.user.userId;
    //         const { data: lineManagerData, error: lineManagerError } = await supabase
    //             .from('staffaccounts')
    //             .select('departmentId')
    //             .eq('userId', lineManagerId)
    //             .single();
    
    //         if (lineManagerError) {
    //             console.error('Error fetching line manager department:', lineManagerError);
    //             throw lineManagerError;
    //         }
    
    //         const lineManagerDepartmentId = lineManagerData?.departmentId;
    
    //         if (!lineManagerDepartmentId) {
    //             console.error('Line manager has no department assigned');
    //             return res.status(400).json({ error: 'Department not assigned to your account' });
    //         }
    
    //         // Fetch applicants awaiting Line Manager action (P1 status) 
    //         // Filter applicants by the line manager's department
    //         const { data: p1Applicants, error: p1ApplicantsError } = await supabase
    //             .from('applicantaccounts')
    //             .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId, departmentId')
    //             .eq('applicantStatus', 'P1 - Awaiting for Line Manager Action; HR PASSED')
    //             .eq('departmentId', lineManagerDepartmentId) // Filter by department ID
    //             .order('created_at', { ascending: false });
    
    //         if (p1ApplicantsError) throw p1ApplicantsError;
    
    //         // Fetch applicants awaiting Line Manager evaluation (P3 status) 
    //         // Filter applicants by the line manager's department
    //         const { data: p3Applicants, error: p3ApplicantsError } = await supabase
    //             .from('applicantaccounts')
    //             .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId, departmentId')
    //             .eq('applicantStatus', 'P3 - Awaiting for Line Manager Evaluation')
    //             .eq('departmentId', lineManagerDepartmentId) // Filter by department ID
    //             .order('created_at', { ascending: false });
    
    //         if (p3ApplicantsError) throw p3ApplicantsError;
    
    //         // Combine the applicants
    //         const allApplicants = [...p1Applicants, ...p3Applicants];
    
    //         // Format the applicants data
    //         const formattedApplicants = allApplicants.map(applicant => ({
    //             id: applicant.applicantId,
    //             firstName: applicant.firstName || 'N/A',
    //             lastName: applicant.lastName || 'N/A',
    //             status: applicant.applicantStatus || 'N/A',
    //             jobId: applicant.jobId, // Include jobId for the redirect
    //             createdAt: applicant.created_at,
    //             formattedDate: new Date(applicant.created_at).toLocaleString('en-US', {
    //                 weekday: 'short', 
    //                 year: 'numeric', 
    //                 month: 'short', 
    //                 day: 'numeric', 
    //                 hour: '2-digit', 
    //                 minute: '2-digit'
    //             })
    //         }));
    
    //         // Fetch pending leave requests for staff in the line manager's department
    //         const { data: leaveRequests, error: leaveError } = await supabase
    //             .from('leaverequests')
    //             .select(`
    //                 leaveRequestId, 
    //                 userId, 
    //                 created_at, 
    //                 fromDate, 
    //                 untilDate, 
    //                 status,
    //                 useraccounts (
    //                     userId, 
    //                     userEmail,
    //                     staffaccounts (
    //                         departmentId,
    //                         departments (deptName), 
    //                         lastName, 
    //                         firstName
    //                     )
    //                 ), 
    //                 leave_types (
    //                     typeName
    //                 )
    //             `)
    //             .eq('status', 'Pending')
    //             .order('created_at', { ascending: false });
    
    //         if (leaveError) throw leaveError;
    
    //         // Filter leave requests to only include those from the line manager's department
    //         const filteredLeaveRequests = leaveRequests.filter(leave => 
    //             leave.useraccounts?.staffaccounts[0]?.departmentId === lineManagerDepartmentId
    //         );
    
    //         // Format leave requests
    //         const formattedLeaveRequests = filteredLeaveRequests.map(leave => ({
    //             userId: leave.userId,
    //             lastName: leave.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
    //             firstName: leave.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
    //             department: leave.useraccounts?.staffaccounts[0]?.departments?.deptName || 'N/A',
    //             filedDate: new Date(leave.created_at).toLocaleString('en-US', {
    //                 weekday: 'short', 
    //                 year: 'numeric', 
    //                 month: 'short', 
    //                 day: 'numeric'
    //             }),
    //             type: leave.leave_types?.typeName || 'N/A',
    //             startDate: leave.fromDate || 'N/A',
    //             endDate: leave.untilDate || 'N/A',
    //             status: leave.status || 'Pending'
    //         }));
    
    //         // Calculate total notification count
    //         const notificationCount = formattedApplicants.length + formattedLeaveRequests.length;
    
    //         // If it's an API request, return JSON
    //         if (req.xhr || req.headers.accept?.includes('application/json') || req.path.includes('/api/')) {
    //             return res
    //                 .header('Content-Type', 'application/json')
    //                 .json({
    //                     applicants: formattedApplicants,
    //                     leaveRequests: formattedLeaveRequests,
    //                     notificationCount: notificationCount
    //                 });
    //         }
    
    //         // Otherwise, return the rendered partial template
    //         return res.render('partials/linemanager_partials', {
    //             applicants: formattedApplicants,
    //             leaveRequests: formattedLeaveRequests,
    //             notificationCount: notificationCount
    //         });
    //     } catch (err) {
    //         console.error('Error fetching notification data:', err);
            
    //         // Better error handling for API requests
    //         if (req.xhr || req.headers.accept?.includes('application/json') || req.path.includes('/api/')) {
    //             return res
    //                 .status(500)
    //                 .header('Content-Type', 'application/json')
    //                 .json({ 
    //                     error: 'An error occurred while loading notifications.',
    //                     details: process.env.NODE_ENV === 'development' ? err.message : undefined
    //                 });
    //         }
            
    //         return res.status(500).send('Error loading notifications');
    //     }
    // },
    
    getLeaveRequest: async function(req, res) {
        const userId = req.query.userId;
    
        console.log('Incoming request query:', req.query);
        
        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required.' });
        }
    
        try {
            console.log('User ID for query:', userId);
    
            const fetchLeaveRequestData = async (userId) => {
                console.log('User ID for fetching leave request:', userId);
                const { data, error } = await supabase
                    .from('leaverequests')
                    .select(`
                        leaveRequestId,
                        userId,
                        fromDate,
                        fromDayType,
                        untilDate,
                        untilDayType,
                        reason,
                        leaveTypeId,
                        useraccounts (
                            userId,
                            staffaccounts (
                                staffId,
                                lastName,
                                firstName,
                                phoneNumber
                            )
                        ),
                        leave_types (
                            typeName
                        )
                    `)
                    .eq('userId', userId);
    
                console.log('Raw leave request data:', data);
                if (error) {
                    console.error('Error details:', error);
                    throw error;
                }
    
                return data;
            };
    
            const leaveRequestData = await fetchLeaveRequestData(userId);
    
            if (!leaveRequestData || leaveRequestData.length === 0) {
                return res.status(404).json({ success: false, message: 'No leave requests found.' });
            }
    
            // Only select the first leave request for rendering
            const leaveRequest = leaveRequestData[0];
            
            const formattedLeaveRequest = {
                leaveRequestId: leaveRequest.leaveRequestId, // Add this line
                userId: leaveRequest.userId,
                fromDate: leaveRequest.fromDate,
                fromDayType: leaveRequest.fromDayType,
                untilDate: leaveRequest.untilDate,
                untilDayType: leaveRequest.untilDayType,
                reason: leaveRequest.reason,
                leaveTypeId: leaveRequest.leaveTypeId,
                leaveTypeName: leaveRequest.leave_types.typeName,
                staff: {
                    lastName: leaveRequest.useraccounts.staffaccounts[0]?.lastName || 'N/A',
                    firstName: leaveRequest.useraccounts.staffaccounts[0]?.firstName || 'N/A',
                    phoneNumber: leaveRequest.useraccounts.staffaccounts[0]?.phoneNumber || 'N/A'
                }
            };
            
            
            return res.render('staffpages/linemanager_pages/managerviewleaverequests', { leaveRequest: formattedLeaveRequest });
    
        } catch (err) {
            console.error('Error fetching leave request:', err);
            return res.status(500).json({ success: false, message: 'Error fetching leave request.' });
        }
    },
    
        
    updateLeaveRequest: async function(req, res) {
        const leaveRequestId = req.body.leaveRequestId || req.query.leaveRequestId;
    const { action, remarks } = req.body;

    console.log('Incoming update request body:', req.body); // Log entire request body
    console.log('leaveRequestId:', leaveRequestId); // Check if leaveRequestId is present
    console.log('Action:', action); // Confirm action is received

    if (!leaveRequestId) {
        console.error('Error: leaveRequestId is missing');
        return res.status(400).json({ success: false, message: 'Leave Request ID is required.' });
    }
    if (!action) {
        console.error('Error: action is missing');
        return res.status(400).json({ success: false, message: 'Action is required.' });
    }
    
        try {
            // Prepare the updated data based on action
            const updatedData = {
                remarkByManager: remarks,
                updatedDate: new Date(),
                status: action === 'approve' ? 'Approved' : 'Rejected'
            };
    
            // Log the prepared update data
            console.log('Updating leave request with data:', updatedData);
    
            // Update the leave request in the Supabase database
            const { data, error } = await supabase
                .from('leaverequests')
                .update(updatedData)
                .eq('leaveRequestId', leaveRequestId);
    
            // Check for errors in the update operation
            if (error) {
                console.error('Error details while updating leave request:', error);
                return res.status(400).json({ success: false, message: 'Failed to update leave request', error });
            }
    
            // Log the successful update
            console.log('Leave request updated successfully:', data);
    
            return res.redirect('/linemanager/dashboard');            return res.redirect('/linemanager/dashboard');
        } catch (error) {
            console.error('Error updating leave request:', error);
            return res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
        }
    },
    
 // Fetch user account information from Supabase
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

        const userData = {
            ...user,
            firstName: staff.firstName,
            lastName: staff.lastName,
            deptName: staff.departments.deptName,
            jobTitle: staff.jobpositions.jobTitle
        };

        res.render('staffpages/employee_pages/useracc', { user: userData });
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
                return res.redirect('staffpages/linemanager_pages/manageruseraccount');
            }

            req.flash('success', 'User information updated successfully!');
            res.redirect('staffpages/linemanager_pages/manageruseraccount');
        } catch (err) {
            console.error('Error in updateUserInfo controller:', err);
            req.flash('errors', { dbError: 'An error occurred while updating the information.' });
            res.redirect('staffpages/linemanager_pages/manageruseraccount')
        }
    },

    getInterviewBookings: function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            res.render('staffpages/linemanager_pages/linemanagerinterviewbookings', {
                user: req.session.user // Passes user data from session to the page
            });
        } catch (err) {
            console.error('Error in getInterviewBookings controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the page.' });
            res.redirect('/linemanager/dashboard');
        }
    },

    getInterviewBookingss: function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            res.render('staffpages/linemanager_pages/linemanagerinterviewbookingss', {
                user: req.session.user // Passes user data from session to the page
            });
        } catch (err) {
            console.error('Error in getInterviewBookings controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the page.' });
            res.redirect('/linemanager/dashboard');
        }
    },
    

    getPersInfoCareerProg: async function(req, res) {
        try {
            console.log("Starting getPersInfoCareerProg...");
    
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                console.log("User not logged in.");
                req.flash('errors', { authError: 'User not logged in.' });
                return res.redirect('/staff/login');
            }
    
            console.log(`Fetching user data for userId: ${userId}`);
    
            // Fetch user email and role from useraccounts table
            const { data: user, error: userError } = await supabase
                .from('useraccounts')
                .select('userEmail, userRole')
                .eq('userId', userId);
    
            if (userError) {
                console.error('Error fetching user data:', userError);
                req.flash('errors', { dbError: 'Error fetching user information.' });
                return res.redirect('/employee/employeepersinfocareerprog');
            }
    
            console.log("User data fetched successfully.");
    
            // Fetch personal information from staffaccounts table
            const { data: staff, error: staffError } = await supabase
                .from('staffaccounts')
                .select('firstName, lastName, phoneNumber, dateOfBirth, emergencyContactName, emergencyContactNumber, employmentType, hireDate, departmentId, jobId, staffId')
                .eq('userId', userId);
    
            if (staffError) {
                console.error('Error fetching staff data:', staffError);
                req.flash('errors', { dbError: 'Error fetching staff information.' });
                return res.redirect('/employee/employeepersinfocareerprog');
            }
    
            console.log("Staff data fetched successfully.");
            const staffId = staff[0]?.staffId;
            if (!staffId) {
                console.error('Staff ID not found for the user.');
                req.flash('errors', { dbError: 'Staff ID not found.' });
                return res.redirect('/employee/employeepersinfocareerprog');
            }
    
            console.log(`Fetching degree information for staffId: ${staffId}`);
    
            // Fetch degree information
            const { data: degrees, error: degreeError } = await supabase
                .from('staffdegrees')
                .select('degreeName, universityName, graduationYear')
                .eq('staffId', staffId);
    
            console.log("Degree information fetched.");
    
            // Fetch job title from jobpositions table
            const jobId = staff[0]?.jobId;
            console.log(`Fetching job title for jobId: ${jobId}`);
            const { data: job, error: jobError } = await supabase
                .from('jobpositions')
                .select('jobTitle')
                .eq('jobId', jobId);
    
            console.log("Job title fetched.");
    
            // Fetch department name from departments table
            const { data: department, error: departmentError } = await supabase
                .from('departments')
                .select('deptName')
                .eq('departmentId', staff[0]?.departmentId);
    
            console.log("Department information fetched.");
    
            // Fetch career progression milestones
            const { data: milestones, error: milestonesError } = await supabase
                .from('staffcareerprogression')
                .select('milestoneName, startDate, endDate')
                .eq('staffId', staffId);
    
            console.log("Career milestones fetched.");
    
            // Fetch experiences
            const { data: experiences, error: experienceError } = await supabase
                .from('staffexperiences')
                .select('companyName, startDate, endDate')
                .eq('staffId', staffId);
    
            console.log("Experience data fetched.");
    
            // Fetch certifications
            const { data: certifications, error: certificationError } = await supabase
                .from('staffcertification')
                .select('certificateName, certDate')
                .eq('staffId', staffId);
    
            console.log("Certifications fetched.");
    
            // Check for any data fetch errors
            if (userError || degreeError || jobError || departmentError || milestonesError || experienceError || certificationError) {
                console.error('Error fetching one or more sets of data:', userError, degreeError, jobError, departmentError, milestonesError, experienceError, certificationError);
                req.flash('errors', { dbError: 'Error fetching data.' });
                return res.redirect('/employee/employeepersinfocareerprog');
            }
    
            // Construct user data
            const userData = {
                userEmail: user[0]?.userEmail || '',
                userRole: user[0]?.userRole || '',
                firstName: staff[0]?.firstName || '',
                lastName: staff[0]?.lastName || '',
                phoneNumber: staff[0]?.phoneNumber || '',
                dateOfBirth: staff[0]?.dateOfBirth || '',
                emergencyContactName: staff[0]?.emergencyContactName || '',
                emergencyContactNumber: staff[0]?.emergencyContactNumber || '',
                employmentType: staff[0]?.employmentType || '',
                hireDate: staff[0]?.hireDate || '',
                jobTitle: job[0]?.jobTitle || '',
                departmentName: department[0]?.deptName || '',
                milestones: milestones || [],
                degrees: degrees || [],
                experiences: experiences || [],
                certifications: certifications || []
            };
    
            console.log("User data constructed successfully.");
    
            // Render the personal information and career progression page
            res.render('staffpages/employee_pages/employeepersinfocareerprog', {
                user: userData,
                errors: req.flash('errors')
            });
        } catch (err) {
            console.error('Error in getPersInfoCareerProg controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the personal info page.' });
            res.redirect('/employee/useracc');
        }
    },

    editPersonalInformation: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            const { firstName, lastName, phone, dateOfBirth, emergencyContactName, emergencyContactNumber } = req.body;
    
            // Log the data received for debugging
            console.log("Received data for update:", { firstName, lastName, phone, dateOfBirth, emergencyContactName, emergencyContactNumber });
    
            // Update the user information in Supabase
            const { error } = await supabase
                .from('staffaccounts')
                .update({
                    firstName,
                    lastName,
                    phoneNumber: phone,
                    dateOfBirth, // Ensure this is the correct field in your Supabase table
                    emergencyContactName,
                    emergencyContactNumber
                })
                .eq('userId', userId);
    
            if (error) {
                console.error('Error updating personal information:', error);
                req.flash('errors', { dbError: 'Error updating personal information.' });
                return res.redirect('/employee/employeepersinfocareerprog');
            }
    
            req.flash('success', { updateSuccess: 'Personal information updated successfully!' });
            res.json({ success: true });
        } catch (err) {
            console.error('Error in editPersonalInformation:', err);
            req.flash('errors', { dbError: 'An error occurred while updating the information.' });
            res.json({ success: false, error: 'An error occurred while updating the information.' });
        }
    },
    
    editCareerProgression: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            // First, get the staffId associated with this userId
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('staffId')
                .eq('userId', userId)
                .single();
    
            if (staffError || !staffData) {
                console.error('Error fetching staff ID:', staffError);
                req.flash('errors', { dbError: 'Error fetching staff information.' });
                return res.status(500).json({ success: false, error: 'Error fetching staff information.' });
            }
    
            const staffId = staffData.staffId;
            const { milestones = [] } = req.body;
    
            console.log("Saving career progression for staffId:", staffId, "Milestones:", milestones);
    
            // Delete old career milestones before inserting new ones
            const { error: deleteError } = await supabase
                .from('staffcareerprogression')
                .delete()
                .eq('staffId', staffId);
                
            if (deleteError) {
                console.error('Error deleting existing milestones:', deleteError);
            }
    
            // Insert new milestones
            for (const milestone of milestones) {
                const { milestoneName, startDate, endDate } = milestone;
                const { error: insertError } = await supabase
                    .from('staffcareerprogression')
                    .insert({
                        milestoneName,
                        startDate,
                        endDate: endDate || null,
                        staffId: staffId
                    });
                    
                if (insertError) {
                    console.error('Error inserting milestone:', insertError);
                    throw insertError;
                }
            }
    
            return res.json({ 
                success: true, 
                message: 'Career progression updated successfully!' 
            });
        } catch (err) {
            console.error('Error in editCareerProgression:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'An error occurred while updating career progression.' 
            });
        }
    },
    
    editDegreeInformation: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            // First, get the staffId associated with this userId
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('staffId')
                .eq('userId', userId)
                .single();
    
            if (staffError || !staffData) {
                console.error('Error fetching staff ID:', staffError);
                req.flash('errors', { dbError: 'Error fetching staff information.' });
                return res.status(500).json({ success: false, error: 'Error fetching staff information.' });
            }
    
            const staffId = staffData.staffId;
            const { degrees = [] } = req.body;
    
            console.log("Saving degree information for staffId:", staffId, "Degrees:", degrees);
    
            // Delete old degrees before inserting new ones
            const { error: deleteError } = await supabase
                .from('staffdegrees')
                .delete()
                .eq('staffId', staffId);
                
            if (deleteError) {
                console.error('Error deleting existing degrees:', deleteError);
            }
    
            // Insert new degrees
            for (const degree of degrees) {
                const { degreeName, universityName, graduationYear } = degree;
                const { error: insertError } = await supabase
                    .from('staffdegrees')
                    .insert({
                        degreeName,
                        universityName,
                        graduationYear,
                        staffId: staffId
                    });
                    
                if (insertError) {
                    console.error('Error inserting degree:', insertError);
                    throw insertError;
                }
            }
    
            return res.json({ 
                success: true, 
                message: 'Degree information updated successfully!' 
            });
        } catch (err) {
            console.error('Error in editDegreeInformation:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'An error occurred while updating degree information.' 
            });
        }
    },
    
    editExperiences: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            // First, get the staffId associated with this userId
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('staffId')
                .eq('userId', userId)
                .single();
    
            if (staffError || !staffData) {
                console.error('Error fetching staff ID:', staffError);
                req.flash('errors', { dbError: 'Error fetching staff information.' });
                return res.status(500).json({ success: false, error: 'Error fetching staff information.' });
            }
    
            const staffId = staffData.staffId;
            const { experiences = [] } = req.body;
    
            console.log("Saving experiences for staffId:", staffId, "Experiences:", experiences);
    
            // Delete old experiences before inserting new ones
            const { error: deleteError } = await supabase
                .from('staffexperiences')
                .delete()
                .eq('staffId', staffId);
                
            if (deleteError) {
                console.error('Error deleting existing experiences:', deleteError);
            }
    
            // Insert new experiences
            for (const experience of experiences) {
                const { companyName, jobTitle, startDate, endDate } = experience;
                const { error: insertError } = await supabase
                    .from('staffexperiences')
                    .insert({
                        companyName,
                        jobTitle: jobTitle || '',
                        startDate,
                        endDate: endDate || null,
                        staffId: staffId
                    });
                    
                if (insertError) {
                    console.error('Error inserting experience:', insertError);
                    throw insertError;
                }
            }
    
            return res.json({ 
                success: true, 
                message: 'Experience information updated successfully!' 
            });
        } catch (err) {
            console.error('Error in editExperiences:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'An error occurred while updating experience information.' 
            });
        }
    },
    
    editCertifications: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            // First, get the staffId associated with this userId
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('staffId')
                .eq('userId', userId)
                .single();
    
            if (staffError || !staffData) {
                console.error('Error fetching staff ID:', staffError);
                req.flash('errors', { dbError: 'Error fetching staff information.' });
                return res.status(500).json({ success: false, error: 'Error fetching staff information.' });
            }
    
            const staffId = staffData.staffId;
            const { certifications = [] } = req.body;
    
            console.log("Saving certifications for staffId:", staffId, "Certifications:", certifications);
    
            // Delete old certifications before inserting new ones
            const { error: deleteError } = await supabase
                .from('staffcertification')  // Note: The table name is 'staffcertification' (singular), not 'staffcertifications'
                .delete()
                .eq('staffId', staffId);
                
            if (deleteError) {
                console.error('Error deleting existing certifications:', deleteError);
            }
    
            // Insert new certifications
            for (const certification of certifications) {
                const { certificateName, certDate } = certification;
                const { error: insertError } = await supabase
                    .from('staffcertification')  // Note: The table name is 'staffcertification' (singular)
                    .insert({
                        certificateName,
                        certDate,
                        staffId: staffId
                    });
                    
                if (insertError) {
                    console.error('Error inserting certification:', insertError);
                    throw insertError;
                }
            }
    
            return res.json({ 
                success: true, 
                message: 'Certification information updated successfully!' 
            });
        } catch (err) {
            console.error('Error in editCertifications:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'An error occurred while updating certification information.' 
            });
        }
    },

// Add this function to your employeeController
updatePersUserInfo: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        // Extract user information from the request body
        const { userEmail, phone, dateOfBirth, emergencyContact, employmentType, jobTitle, department, hireDate } = req.body;

        // Update user account information
        const { error: userError } = await supabase
            .from('useraccounts')
            .update({
                userEmail, // Update email
                phone, // Assuming you add a phone field to useraccounts
                dateOfBirth, // Assuming you add a dateOfBirth field to useraccounts
                emergencyContact // Assuming you add an emergencyContact field to useraccounts
            })
            .eq('userId', userId);

        // Check for errors
        if (userError) {
            console.error('Error updating user account:', userError);
            req.flash('errors', { dbError: 'Error updating user information.' });
            return res.redirect('/employee/persinfocareerprog');
        }

        // Update staff account information
        const { error: staffError } = await supabase
            .from('staffaccounts')
            .update({
                employmentType,
                jobTitle,
                department,
                hireDate
            })
            .eq('userId', userId);

        // Check for errors
        if (staffError) {
            console.error('Error updating staff account:', staffError);
            req.flash('errors', { dbError: 'Error updating staff information.' });
            return res.redirect('/staff/employee/persinfocareerprog');
        }

        // Redirect back to the personal information page with success message
        req.flash('success', { updateSuccess: 'User information updated successfully!' });
        res.redirect('/staff/employee/persinfocareerprog');

    } catch (err) {
        console.error('Error in updateUserInfo controller:', err);
        req.flash('errors', { dbError: 'An error occurred while updating the information.' });
        res.redirect('/staff/employee/persinfocareerprog');
    }
},

    getMRF: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                // Fetch MRF data
                const { data: mrfList, error: mrfError } = await supabase
                    .from('mrf')
                    .select('positionTitle, requisitionDate, mrfId, status'); // include status in query
            
                if (mrfError) throw mrfError;
        
                // Fetch approval statuses
                const { data: approvals, error: approvalError } = await supabase
                    .from('mrf_approvals')
                    .select('mrfId, approval_stage');
        
                if (approvalError) throw approvalError;
        
                // Combine MRF data with approval statuses
                const combinedData = mrfList.map(mrf => {
                    const approval = approvals.find(a => a.mrfId === mrf.mrfId);
                    const status = approval ? approval.approval_stage : mrf.status || 'Pending'; // Default to 'Pending' if no approval data
                    return {
                        positionTitle: mrf.positionTitle,
                        requisitionDate: mrf.requisitionDate,
                        status: status,
                        mrfId: mrf.mrfId
                    };
                });
        
                res.render('staffpages/linemanager_pages/mrf', { mrfRequests: combinedData });
            } catch (error) {
                console.error("Error in getMRF:", error);
                req.flash('errors', { fetchError: 'Error fetching MRF data.' });
                res.redirect('/staff/login');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getMRFList: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            MRFModel.find({}, (err, mrfList) => {
                if (err) {
                    req.flash('errors', { fetchError: 'Error fetching MRF list.' });
                }
                res.render('staffpages/linemanager_pages/mrf_list', { mrfList });
            });
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getEvaluationForm: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/linemanagerinterviewform');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getInterviewFormLinemanager: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/interview-form-linemanager');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getFirstDayObjectiveSetting: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/linemanagerfirstdayobjectivesetting');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },
    
    getApplicantTracker: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                // First, get the line manager's department ID
                const userId = req.session.user.userId;
                const { data: lineManagerData, error: lineManagerError } = await supabase
                    .from('staffaccounts')
                    .select('departmentId')
                    .eq('userId', userId)
                    .single();
    
                if (lineManagerError) {
                    console.error('Error fetching line manager department:', lineManagerError);
                    throw lineManagerError;
                }
    
                const lineManagerDepartmentId = lineManagerData?.departmentId;
    
                if (!lineManagerDepartmentId) {
                    console.error('Line manager has no department assigned');
                    req.flash('errors', { authError: 'Department not assigned to your account. Please contact HR.' });
                    return res.redirect('/staff/login');
                }
    
                // Fetch job positions filtered by the line manager's department
                const { data: jobpositions, error: jobpositionsError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle, hiringStartDate, hiringEndDate, departmentId')
                    .eq('departmentId', lineManagerDepartmentId) // Filter by the line manager's department
                    .order('hiringStartDate', { ascending: true });
    
                if (jobpositionsError) throw jobpositionsError;
    
                // Fetch all departments for dropdown
                const { data: departments, error: departmentsError } = await supabase
                    .from('departments')
                    .select('deptName, departmentId');
    
                if (departmentsError) throw departmentsError;
    
                // Fetch all applicant accounts with created_at date
                const { data: applicantaccounts, error: applicantaccountsError } = await supabase
                    .from('applicantaccounts')
                    .select('jobId, applicantStatus, created_at');
    
                if (applicantaccountsError) throw applicantaccountsError;
    
                console.log('Applicant Accounts:', applicantaccounts);
    
                // Group and count statuses by jobId
                const statusCountsMap = {};
                const applicantDatesMap = {}; // To track application dates for each job
    
                applicantaccounts.forEach(({ jobId, applicantStatus, created_at }) => {
                    // Initialize if first time seeing this jobId
                    if (!statusCountsMap[jobId]) {
                        statusCountsMap[jobId] = { P1: 0, P2: 0, P3: 0, Offered: 0, Onboarding: 0 };
                        applicantDatesMap[jobId] = []; // Initialize array to store application dates
                    }
                    
                    // Add application date to the array for this job
                    if (created_at) {
                        applicantDatesMap[jobId].push(new Date(created_at));
                    }
                    
                    // Count applicants by status
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
                });
    
                console.log('Status Counts Map:', statusCountsMap);
                console.log('Applicant Dates Map:', applicantDatesMap);
    
                // Function to check if any application date falls within hiring date range
                const hasApplicantsInDateRange = (jobId, hiringStart, hiringEnd) => {
                    const applicantDates = applicantDatesMap[jobId] || [];
                    const start = new Date(hiringStart);
                    const end = new Date(hiringEnd);
                    
                    // Check if any application date falls within the hiring range
                    return applicantDates.some(date => date >= start && date <= end);
                };
    
                // Merge counts into job positions with date check
                const jobPositionsWithCounts = jobpositions.map((job) => {
                    const withinHiringRange = hasApplicantsInDateRange(
                        job.jobId, 
                        job.hiringStartDate, 
                        job.hiringEndDate
                    );
                    
                    return {
                        ...job,
                        departmentName: departments.find(dept => dept.departmentId === job.departmentId)?.deptName || 'Unknown',
                        counts: statusCountsMap[job.jobId] || { P1: 0, P2: 0, P3: 0, Offered: 0, Onboarding: 0 },
                        hasApplicantsInDateRange: withinHiringRange // Add flag for highlighting in frontend
                    };
                });
    
                // Render the page
                res.render('staffpages/linemanager_pages/linemanagerapplicanttracking', {
                    jobPositions: jobPositionsWithCounts,
                    departments,
                });
            } catch (err) {
                console.error('Error:', err);
                req.flash('errors', { databaseError: 'Error fetching job data.' });
                res.redirect('/staff/login');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getApplicantTrackerByJobPositions: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                const { jobId, applicantId, userId } = req.query;
                console.log('Received request with jobId:', jobId, 'and applicantId:', applicantId);
                console.log('Received request with userId:', userId);

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
            
    
                // Fetch user emails using userId
                const { data: userAccounts, error: userError } = await supabase
                    .from('useraccounts')
                    .select('userId, userEmail');
    
                if (userError) throw userError;
    
                // Fetch job titles and department names
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
    
//                 // Merge jobTitle, deptName, userEmail, and scores with applicants data
//                 const applicantsWithDetails = applicants.map(applicant => {
//                     const jobTitle = jobTitles.find(job => job.jobId === applicant.jobId)?.jobTitle || 'N/A';
//                     const deptName = departments.find(dept => dept.departmentId === applicant.departmentId)?.deptName || 'N/A';
//                     const userEmail = userAccounts.find(user => user.userId === applicant.userId)?.userEmail || 'N/A';
                
//                     let formattedStatus = applicant.applicantStatus;

// // If Line Manager has approved, set status to "P1: PASSED"
// if (applicant.lineManagerApproved) {
//     formattedStatus = 'P1 - PASSED';
// } else {
//     // Check Initial Screening Score
//     if (applicant.initialScreeningScore === null || applicant.initialScreeningScore === undefined) {
//         formattedStatus = 'P1 - Initial Screening';
//     } else if (applicant.initialScreeningScore < 50) {
//         formattedStatus = 'P1 - FAILED';
//     } else {
//         formattedStatus = `P1 - Awaiting for HR Action; Initial Screening Score: ${applicant.initialScreeningScore}`;
//     }

//     // Check HR Interview Score
//     if (applicant.hrInterviewFormScore !== null && applicant.hrInterviewFormScore !== undefined) {
//         if (applicant.hrInterviewFormScore < 50) {
//             formattedStatus = 'P1 - FAILED';
//         } else if (applicant.hrInterviewFormScore > 45 && applicant.isChosen1) {
//             formattedStatus = 'P1 - Awaiting for Line Manager Action; HR PASSED';
//         } else if (formattedStatus.startsWith('P1 - Awaiting for HR Action')) {
//             formattedStatus += `; HR Interview Score: ${applicant.hrInterviewFormScore}`;
//         }
//     }
// }
                
// // Log for debugging
// console.log("Applicant:", applicant.firstName, applicant.lastName, 
//     "Initial Screening Score:", applicant.initialScreeningScore, 
//     "HR Interview Score:", applicant.hrInterviewFormScore, 
//     "isChosen1:", applicant.isChosen1, 
//     "lineManagerApproved:", applicant.lineManagerApproved,
//     "LM_notified:", applicant.LM_notified,
//     "=> Status:", formattedStatus);
                
//                     // Return the updated applicant object with the formatted status
//                     return {
//                         ...applicant,
//                         jobTitle,
//                         deptName,
//                         userEmail,
//                         applicantStatus: formattedStatus, // Return the updated status
//                     };
//                 });
                
                // // Render the EJS template with applicants data
                // res.render('staffpages/linemanager_pages/linemanagerapplicanttracking-jobposition', {
                //     applicants: applicantsWithDetails,
                // });

                // Render the page with updated applicants
res.render('staffpages/linemanager_pages/linemanagerapplicanttracking-jobposition', { applicants });res.render('staffpages/linemanager_pages/linemanagerapplicanttracking-jobposition', { 
    applicants,
    applicantsJSON: JSON.stringify(applicants) // Add this line to make data accessible in script
  });            } catch (error) {
                console.error('Error fetching applicants:', error);
                res.status(500).json({ error: 'Error fetching applicants' });
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized access. Line Manager role required.' });
            res.redirect('/staff/login');
        }
    },

    finalizeP1Review: async function(req, res) {
        try {
            console.log('✅ [LineManager] Finalizing P1 review process');
            
            const { passedUserIds, failedUserIds } = req.body;
            
            if (!passedUserIds || !failedUserIds) {
                return res.status(400).json({ success: false, message: "Missing user IDs" });
            }
            
            console.log(`✅ [LineManager] P1 Finalization: ${passedUserIds.length} passed, ${failedUserIds.length} failed`);
            
            // Process passed applicants
            for (const userId of passedUserIds) {
                console.log(`✅ [LineManager] Finalizing P1 PASSED for userId: ${userId}`);
                
                // 1. Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P1 - PASSED' })
                    .eq('userId', userId);
                    
                if (updateError) {
                    console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
                    continue;
                }
                
                // 2. Send congratulations message through the chatbot history
                const congratsMessage = "Congratulations! We are delighted to inform you that you have successfully passed the initial screening process. We look forward to proceeding with the next interview stage once the HR team sets availability via Calendly.";
                
                const { data: chatData, error: chatError } = await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: congratsMessage }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P1 - PASSED'
                    }]);
                    
                if (chatError) {
                    console.error(`❌ [LineManager] Error sending chat message to ${userId}:`, chatError);
                }
            }
            
            // Process failed applicants
            for (const userId of failedUserIds) {
                console.log(`✅ [LineManager] Finalizing P1 FAILED for userId: ${userId}`);
                
                // 1. Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P1 - FAILED' })
                    .eq('userId', userId);
                    
                if (updateError) {
                    console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
                    continue;
                }
                
                // 2. Send rejection message through the chatbot history
                const rejectionMessage = "We regret to inform you that you have not been chosen as a candidate for this position. Thank you for your interest in applying at Prime Infrastructure, and we wish you the best in your future endeavors.";
                
                const { data: chatData, error: chatError } = await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: rejectionMessage }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P1 - FAILED'
                    }]);
                    
                if (chatError) {
                    console.error(`❌ [LineManager] Error sending chat message to ${userId}:`, chatError);
                }
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "P1 review finalized successfully and applicants have been notified.",
                passedCount: passedUserIds.length,
                failedCount: failedUserIds.length
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error finalizing P1 review:', error);
            return res.status(500).json({ success: false, message: "Error finalizing P1 review: " + error.message });
        }
    },
    
    /**
     * Finalizes the P3 review process and notifies applicants
     * This should be called when the Line Manager clicks "Finalize P3 Review"
     */
    finalizeP3Review: async function(req, res) {
        try {
            console.log('✅ [LineManager] Finalizing P3 review process');
            
            const { passedUserIds, failedUserIds } = req.body;
            
            if (!passedUserIds || !failedUserIds) {
                return res.status(400).json({ success: false, message: "Missing user IDs" });
            }
            
            console.log(`✅ [LineManager] P3 Finalization: ${passedUserIds.length} passed, ${failedUserIds.length} failed`);
            
            // Process passed applicants
            for (const userId of passedUserIds) {
                console.log(`✅ [LineManager] Finalizing P3 PASSED for userId: ${userId}`);
                
                // 1. Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P3 - PASSED' })
                    .eq('userId', userId);
                    
                if (updateError) {
                    console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
                    continue;
                }
                
                // 2. Send congratulations message through the chatbot history
                const congratsMessage = "Congratulations! We are delighted to inform you that you have successfully passed the final interview. You will be contacted soon with job offer details.";
                
                const { data: chatData, error: chatError } = await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: congratsMessage }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - PASSED'
                    }]);
                    
                if (chatError) {
                    console.error(`❌ [LineManager] Error sending chat message to ${userId}:`, chatError);
                }
            }
            
            // Process failed applicants
            for (const userId of failedUserIds) {
                console.log(`✅ [LineManager] Finalizing P3 FAILED for userId: ${userId}`);
                
                // 1. Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P3 - FAILED' })
                    .eq('userId', userId);
                    
                if (updateError) {
                    console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
                    continue;
                }
                
                // 2. Send rejection message through the chatbot history
                const rejectionMessage = "We appreciate your participation in our interview process. After careful consideration, we regret to inform you that we will not be proceeding with your application at this time. Thank you for your interest in Prime Infrastructure.";
                
                const { data: chatData, error: chatError } = await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: rejectionMessage }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - FAILED'
                    }]);
                    
                if (chatError) {
                    console.error(`❌ [LineManager] Error sending chat message to ${userId}:`, chatError);
                }
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "P3 review finalized successfully and applicants have been notified.",
                passedCount: passedUserIds.length,
                failedCount: failedUserIds.length
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error finalizing P3 review:', error);
            return res.status(500).json({ success: false, message: "Error finalizing P3 review: " + error.message });
        }
    },
    markAsP1Passed: async function(req, res) {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ success: false, message: "Missing user ID" });
            }
            
            // Update the status for display purposes only
            const { data, error } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - PASSED (Pending Finalization)' })
                .eq('userId', userId);
                
            if (error) {
                console.error('❌ [LineManager] Error marking applicant as PASSED:', error);
                return res.status(500).json({ success: false, message: "Error updating applicant status" });
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "Applicant marked as PASSED. Status will be finalized and applicant will be notified upon review finalization."
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error marking as PASSED:', error);
            return res.status(500).json({ success: false, message: "Error marking applicant as PASSED: " + error.message });
        }
    },
    
    /**
     * Temporary marks an applicant as FAILED in the Line Manager's view
     * This doesn't notify the applicant yet
     */
    markAsP1Failed: async function(req, res) {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ success: false, message: "Missing user ID" });
            }
            
            // Update the status for display purposes only
            const { data, error } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - FAILED (Pending Finalization)' })
                .eq('userId', userId);
                
            if (error) {
                console.error('❌ [LineManager] Error marking applicant as FAILED:', error);
                return res.status(500).json({ success: false, message: "Error updating applicant status" });
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "Applicant marked as FAILED. Status will be finalized and applicant will be notified upon review finalization."
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error marking as FAILED:', error);
            return res.status(500).json({ success: false, message: "Error marking applicant as FAILED: " + error.message });
        }
    },
    
    /**
     * Temporary marks an applicant as PASSED for P3 in the Line Manager's view
     * This doesn't notify the applicant yet
     */
    markAsP3Passed: async function(req, res) {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ success: false, message: "Missing user ID" });
            }
            
            // Update the status for display purposes only
            const { data, error } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P3 - PASSED (Pending Finalization)' })
                .eq('userId', userId);
                
            if (error) {
                console.error('❌ [LineManager] Error marking applicant as P3 PASSED:', error);
                return res.status(500).json({ success: false, message: "Error updating applicant status" });
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "Applicant marked as P3 PASSED. Status will be finalized and applicant will be notified upon review finalization."
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error marking as P3 PASSED:', error);
            return res.status(500).json({ success: false, message: "Error marking applicant as P3 PASSED: " + error.message });
        }
    },
    
    /**
     * Temporary marks an applicant as FAILED for P3 in the Line Manager's view
     * This doesn't notify the applicant yet
     */
    markAsP3Failed: async function(req, res) {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ success: false, message: "Missing user ID" });
            }
            
            // Update the status for display purposes only
            const { data, error } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P3 - FAILED (Pending Finalization)' })
                .eq('userId', userId);
                
            if (error) {
                console.error('❌ [LineManager] Error marking applicant as P3 FAILED:', error);
                return res.status(500).json({ success: false, message: "Error updating applicant status" });
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "Applicant marked as P3 FAILED. Status will be finalized and applicant will be notified upon review finalization."
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error marking as P3 FAILED:', error);
            return res.status(500).json({ success: false, message: "Error marking applicant as P3 FAILED: " + error.message });
        }
    },

    // updateP1LineManagerPassed: async function(req, res) {
    //     try {
    //         const { passedUserIds, failedUserIds } = req.body;
            
    //         if (!passedUserIds || !failedUserIds) {
    //             return res.status(400).json({ success: false, message: "Missing required data" });
    //         }
            
    //         console.log(`Finalizing P1 review for ${passedUserIds.length} passed and ${failedUserIds.length} failed applicants`);
            
    //         // Update passed applicants to P1 - PASSED
    //         if (passedUserIds.length > 0) {
    //             const { data: passedData, error: passedError } = await supabase
    //                 .from('applicantaccounts')
    //                 .update({ applicantStatus: 'P1 - PASSED' })
    //                 .in('userId', passedUserIds);
                    
    //             if (passedError) {
    //                 console.error(`Error updating P1 passed applicants:`, passedError);
    //                 return res.status(500).json({ success: false, message: "Error updating passed applicants" });
    //             }
    //         }
            
    //         // Update failed applicants to P1 - FAILED
    //         if (failedUserIds.length > 0) {
    //             const { data: failedData, error: failedError } = await supabase
    //                 .from('applicantaccounts')
    //                 .update({ applicantStatus: 'P1 - FAILED' })
    //                 .in('userId', failedUserIds);
                    
    //             if (failedError) {
    //                 console.error(`Error updating P1 failed applicants:`, failedError);
    //                 return res.status(500).json({ success: false, message: "Error updating failed applicants" });
    //             }
    //         }
            
    //         // Send success response
    //         return res.status(200).json({ 
    //             success: true, 
    //             message: `Successfully finalized P1 review for ${passedUserIds.length + failedUserIds.length} applicants` 
    //         });
            
    //     } catch (error) {
    //         console.error("Error finalizing P1 review:", error);
    //         return res.status(500).json({ success: false, message: "Server error" });
    //     }
    // },

    // updateP3LineManagerPassed: async function(req, res) {
    //     try {
    //         const { passedUserIds, failedUserIds } = req.body;
            
    //         if (!passedUserIds || !failedUserIds) {
    //             return res.status(400).json({ success: false, message: "Missing required data" });
    //         }
            
    //         console.log(`Finalizing P3 review for ${passedUserIds.length} passed and ${failedUserIds.length} failed applicants`);
            
    //         // Update passed applicants to P3 - PASSED
    //         if (passedUserIds.length > 0) {
    //             const { data: passedData, error: passedError } = await supabase
    //                 .from('applicantaccounts')
    //                 .update({ applicantStatus: 'P3 - PASSED' })
    //                 .in('userId', passedUserIds);
                    
    //             if (passedError) {
    //                 console.error(`Error updating P3 passed applicants:`, passedError);
    //                 return res.status(500).json({ success: false, message: "Error updating passed applicants" });
    //             }
    //         }
            
    //         // Update failed applicants to P3 - FAILED
    //         if (failedUserIds.length > 0) {
    //             const { data: failedData, error: failedError } = await supabase
    //                 .from('applicantaccounts')
    //                 .update({ applicantStatus: 'P3 - FAILED' })
    //                 .in('userId', failedUserIds);
                    
    //             if (failedError) {
    //                 console.error(`Error updating P3 failed applicants:`, failedError);
    //                 return res.status(500).json({ success: false, message: "Error updating failed applicants" });
    //             }
    //         }
            
    //         // Send success response
    //         return res.status(200).json({ 
    //             success: true, 
    //             message: `Successfully finalized P3 review for ${passedUserIds.length + failedUserIds.length} applicants` 
    //         });
            
    //     } catch (error) {
    //         console.error("Error finalizing P3 review:", error);
    //         return res.status(500).json({ success: false, message: "Server error" });
    //     }
    // },


    

    postApproveLineManager: async function (req, res) {
        console.log('Request Body:', req.body); // Log the entire request body
    
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            const { applicantId } = req.body; // Get applicantId from request body
    
            if (!applicantId) {
                return res.status(400).json({ success: false, error: 'Missing applicantId' });
            }
    
            try {
                const { error } = await supabase
                .from('applicantaccounts')
                .update({ 
                    applicantStatus: 'P1 - PASSED', // Ensure correct status
                    lineManagerApproved: true 
                })
                .eq('applicantId', applicantId);
    
                if (error) throw error;
    
                res.json({ success: true, message: 'Line Manager approved successfully' });
            } catch (error) {
                console.error('Error updating applicant status:', error);
                return res.status(500).json({ success: false, error: 'Failed to approve Line Manager' });
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized access. Line Manager role required.' });
            res.redirect('/staff/login');
        }
    },
    
    

    getFinalResult: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/linemanagerfinalresult');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getApprovedFinalResult: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/approvedfinalresults');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getRejectedFinalResult: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/rejectedfinalresults');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },
    
    
    getRequestMRF: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                const { data: departments, error } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
    
                if (error) throw error;
    
                res.render('staffpages/linemanager_pages/request-mrf', { departments });
            } catch (err) {
                req.flash('errors', { fetchError: 'Error fetching departments.' });
                res.redirect('/linemanager/mrf'); 
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },
    

    submitMRF: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            return res.redirect('/staff/login');
        }
    
        console.log("Request Body:", req.body); // Log the entire form data
    
        const mrfData = {
            jobGrade: req.body.jobGrade,
            positionTitle: req.body.positionTitle,
            departmentId: req.body.departmentId,
            location: req.body.location,
            requisitionDate: req.body.requisitionDate,
            requiredDate: req.body.requiredDate,
            numPersonsRequisitioned: req.body.numPersonsRequisitioned,
            requisitionType: req.body.requisitionType,
            employmentNature: req.body.employmentNature,
            employeeCategory: req.body.employeeCategory,
            justification: req.body.justification || '', // Default to an empty string if undefined
            requiredAttachments: req.body.requiredAttachments ? req.body.requiredAttachments.join(', ') : '',
            userId: req.session.user.userId,
            status: 'Pending'
        };
    
        console.log("MRF Data to be inserted:", mrfData);
    
        try {
            // Insert MRF
            const { data, error } = await supabase
                .from('mrf')
                .insert([mrfData])
                .select();
    
            if (error) {
                console.error("Supabase Error (MRF):", error.message, error.details);
                throw error;
            }
    
            if (!data || data.length === 0) {
                throw new Error("No MRF data returned after insertion.");
            }
    
            console.log("Inserted MRF data:", data);
    
            // Log the approval status from the form
            console.log("Approval Status:", req.body.approvalStatus);
    
            // Log the MRF ID
            console.log("Inserted MRF ID:", data[0].mrfId);
    
            // Approval logic
            if (req.body.approvalStatus === 'approved') {
                let reviewerName;
    
                // Fetch the reviewer's name if it's missing from the session
                if (!req.session.user.userName) {
                    const { data: staffData, error: staffError } = await supabase
                        .from('staffaccounts')
                        .select('firstName, lastName')
                        .eq('userId', req.session.user.userId)
                        .single();
    
                    if (staffError) {
                        console.error("Error fetching staff details:", staffError.message, staffError.details);
                        throw staffError;
                    }
    
                    reviewerName = `${staffData.firstName} ${staffData.lastName}`.trim();
                } else {
                    reviewerName = req.session.user.userName;
                }
    
                console.log("Reviewer Name:", reviewerName);
    
                const approvalData = {
                    mrfId: data[0].mrfId,
                    staffId: req.session.user.userId,
                    approval_stage: req.session.user.userRole,
                    reviewerName, 
                    reviewerDateSigned: new Date().toISOString()
                };
    
                console.log("Approval Data to be inserted:", approvalData);
    
                const { error: approvalError } = await supabase
                    .from('mrf_approvals')
                    .insert([approvalData]);
    
                if (approvalError) {
                    console.error("Supabase Error (MRF Approvals):", approvalError.message, approvalError.details);
                    throw approvalError;
                }
    
                console.log("Approval data inserted:", approvalData);
            } else {
                console.log("Approval checkbox was not checked.");
            }
    
            req.flash('success', { message: 'MRF Request submitted successfully!' });
            return res.redirect('/linemanager/mrf');
        } catch (error) {
            console.error("Error in MRF submission or approval insertion:", error);
            req.flash('errors', { submissionError: 'Failed to submit MRF. Please try again.' });
            return res.redirect('/linemanager/mrf'); // Redirecting to /linemanager/mrf on error as well
        }
    },      
    
    // almost the same logic as hr but only by the same department is fetched.
    getRecordsPerformanceTrackerByDepartmentId: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                const userId = req.session.user.userId; // Get the logged-in user's userId
                console.log('User ID:', userId); // Log the userId for debugging
    
                if (!userId) {
                    req.flash('errors', { fetchError: 'User ID is not defined. Please log in again.' });
                    return res.redirect('/staff/login');
                }
    
                // Fetch data from useraccounts table
                const { data: userData, error: userError } = await supabase
                    .from('useraccounts')
                    .select('userId, userEmail')
                    .eq('userId', userId)
                    .single(); // Get a single user account
    
                if (userError || !userData) {
                    throw userError || new Error('Failed to fetch user data.');
                }
    
                // Now fetch the associated staff account to get departmentId
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select('departmentId')
                    .eq('userId', userId)
                    .single(); // Get a single staff record
    
                if (staffError || !staffData) {
                    throw staffError || new Error('Failed to fetch staff data.');
                }
    
                const deptId = staffData.departmentId; // Retrieve departmentId
                console.log('Department ID:', deptId); // Log the departmentId for debugging
    
                if (!deptId) {
                    req.flash('errors', { fetchError: 'Department ID is not defined. Please log in again.' });
                    return res.redirect('/staff/login');
                }
    
                // Fetch data from staffaccounts filtered by departmentId
                const { data: employeeData, error: fetchError } = await supabase
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
                    .eq('departmentId', deptId) // Filter by departmentId
                    .order('lastName', { ascending: true }); // Sort by lastName
    
                if (fetchError) {
                    throw fetchError;
                }
    
                // Map the fetched data to a structured employee list
                const employeeList = employeeData.map(staff => ({
                    userId: staff.userId || 'Unknown',  // Ensure userId exists
                    lastName: staff.lastName || 'Unknown',
                    firstName: staff.firstName || 'Unknown',
                    deptName: staff.departments?.deptName || 'Unknown',
                    jobTitle: staff.jobpositions?.jobTitle || 'No job title assigned',
                    email: staff.useraccounts?.userEmail || 'N/A'
                }));
    
                console.log("Employee data fetched successfully:", employeeList);
    
                const errors = req.flash('errors') || {};  
                res.render('staffpages/linemanager_pages/managerrecordsperftracker', { errors, employees: employeeList });
    
            } catch (error) {
                console.error('Error fetching Employee Records and Performance History data:', error);
                req.flash('errors', { fetchError: 'Failed to fetch employee records. Please try again.' });
                res.redirect('/linemanager/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    getRecordsPerformanceTrackerByUserId: async function(req, res, next) {
        try {
            const userId = req.params.userId;
            console.log('Fetching records for userId:', userId);
        
            if (!userId) {
                req.flash('errors', { authError: 'User not logged in.' });
                return res.redirect('/staff/login');
            }
        
            // Fetch user-related data
            const { data: userData, error } = await supabase
                .from('useraccounts')
                .select(`
                    userId,
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
                        departments ( deptName ),
                        jobpositions ( jobTitle ),
                        staffdegrees ( degreeName, universityName, graduationYear ),
                        staffcareerprogression ( milestoneName, startDate, endDate ),
                        staffexperiences ( companyName, startDate ),
                        staffcertification!staffcertification_staffId_fkey ( certificateName, certDate )
                    )
                `)
                .eq('userId', userId)
                .single();
        
            if (error) throw error;
        
            console.log('Fetched user data:', userData);
        
            // Fetch attendance logs for the specific user
            const { data: attendanceLogs, error: attendanceError } = await supabase
                .from('attendance')
                .select(`
                    userId, 
                    attendanceDate, 
                    attendanceAction, 
                    attendanceTime, 
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
                .eq('userId', userId)
                .order('attendanceDate', { ascending: false });
        
            if (attendanceError) throw attendanceError;
        
            // Format attendance logs by week
            const formattedAttendanceLogs = attendanceLogs.reduce((acc, attendance) => {
                const attendanceDate = new Date(attendance.attendanceDate);
                // Get the week number for the given date (ISO week)
                const weekNumber = getISOWeek(attendanceDate);
                
                const weekEntry = acc.find(log => log.weekNumber === weekNumber);
        
                if (!weekEntry) {
                    acc.push({
                        weekNumber,
                        days: [{
                            date: attendanceDate,
                            attendanceAction: attendance.attendanceAction,
                            attendanceTime: attendance.attendanceTime
                        }]
                    });
                } else {
                    weekEntry.days.push({
                        date: attendanceDate,
                        attendanceAction: attendance.attendanceAction,
                        attendanceTime: attendance.attendanceTime
                    });
                }
        
                return acc;
            }, []);
        
            // Compile the userData into the format required for the template
            const formattedUserData = {
                userId: userData.userId,
                userEmail: userData.userEmail || '',
                userRole: userData.userRole || '',
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
                certifications: userData.staffaccounts[0]?.staffcertification || [],
                weeklyAttendanceLogs: formattedAttendanceLogs // Add weekly attendance logs
            };
        
            req.user = formattedUserData;
            next();
        } catch (err) {
            console.error('Error in getRecordsPerformanceTrackerByUserId controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the personal info page.' });
            res.redirect('/staffpages/linemanager_pages/managerrecordsperftracker');
        }
    },

    // code with midyearidp logic
    getUserProgressView: async function(req, res) {
        const user = req.user;
        console.log('Fetching records for userId:', user?.userId);
    
        if (!user) {
            req.flash('errors', { authError: 'Unauthorized. Please log in to access this view.' });
            return res.redirect('/staff/login');
        }
    
        try {
            const { data: jobData, error: jobError } = await supabase
                .from('staffaccounts')
                .select('jobId')
                .eq('userId', user.userId)
                .single();
    
            if (jobError || !jobData) {
                console.error('Error fetching jobId:', jobError);
                req.flash('errors', { fetchError: 'Error fetching job information. Please try again.' });
                return res.redirect('/linemanager/records-performance-tracker');
            }
    
            const jobId = jobData.jobId;
            console.log('Fetched jobId:', jobId);
    
            const feedbackTables = ['feedbacks_Q1', 'feedbacks_Q2', 'feedbacks_Q3', 'feedbacks_Q4'];
            const yearPromises = feedbackTables.map(table => 
                supabase.from(table).select('year')
            );
    
            const yearResults = await Promise.all(yearPromises);
            const allYears = yearResults.flatMap(result => result.data || []);
            const availableYears = [...new Set(allYears.map(year => year.year))].sort((a, b) => b - a);
            const selectedYear = req.query.year || new Date().getFullYear();
    
            const feedbackData = {};
            for (const table of feedbackTables) {
                const { data, error } = await supabase
                    .from(table)
                    .select('*')
                    .eq('userId', user.userId)
                    .eq('jobId', jobId)
                    .eq('year', selectedYear);
    
                if (error) {
                    console.error(`Error fetching feedback data from ${table}:`, error);
                    req.flash('errors', { fetchError: `Error fetching data for ${table}. Please try again.` });
                    return res.redirect('/linemanager/records-performance-tracker');
                }
    
                feedbackData[table] = data;
            }
    
            console.log("Feedback Data:", feedbackData);
    
            // Fetch objectives settings
            const { data: objectiveSettings, error: objectivesError } = await supabase
                .from('objectivesettings')
                .select('*')
                .eq('userId', user.userId);
    
            if (objectivesError) {
                console.error('Error fetching objectives settings:', objectivesError);
                req.flash('errors', { fetchError: 'Error fetching objectives settings. Please try again.' });
                return res.redirect('/linemanager/records-performance-tracker');
            }
    
            let submittedObjectives = [];
            let objectiveQuestions = [];
    
            if (objectiveSettings.length > 0) {
                const objectiveSettingsIds = objectiveSettings.map(setting => setting.objectiveSettingsId);
    
                // Fetch the actual objectives related to the settings
                const { data: objectivesData, error: objectivesFetchError } = await supabase
                    .from('objectivesettings_objectives')
                    .select('*')
                    .in('objectiveSettingsId', objectiveSettingsIds);
    
                if (objectivesFetchError) {
                    console.error('Error fetching objectives:', objectivesFetchError);
                    req.flash('errors', { fetchError: 'Error fetching objectives. Please try again.' });
                    return res.redirect('/linemanager/records-performance-tracker');
                }
    
                submittedObjectives = objectivesData;
    
                // Fetch questions related to the objectives
                const { data: objectiveQuestionData, error: questionError } = await supabase
                    .from('feedbacks_questions-objectives')
                    .select('objectiveId, objectiveQualiQuestion')
                    .in('objectiveId', submittedObjectives.map(obj => obj.objectiveId));
    
                if (questionError) {
                    console.error('Error fetching objective questions:', questionError);
                    req.flash('errors', { fetchError: 'Error fetching objective questions. Please try again.' });
                    return res.redirect('/linemanager/records-performance-tracker');
                }
    
                objectiveQuestions = objectiveQuestionData;
            }
    
            // Map the `objectiveQuestions` to `submittedObjectives`
            submittedObjectives = submittedObjectives.map(obj => {
                const questions = objectiveQuestions.filter(q => q.objectiveId === obj.objectiveId);
                return {
                    ...obj,
                    objectiveQualiQuestion: questions.length > 0 ? questions.map(q => q.objectiveQualiQuestion).join(', ') : 'No questions available'
                };
            });
    
            // Fetch job requirements skills based on jobId
            const { data: skillsData, error: skillsError } = await supabase
                .from('jobreqskills')
                .select('jobReqSkillType, jobReqSkillName')
                .eq('jobId', jobId);
    
            if (skillsError) {
                console.error('Error fetching job requirements skills:', skillsError);
                req.flash('errors', { fetchError: 'Error fetching skills data. Please try again.' });
                return res.redirect('/linemanager/records-performance-tracker');
            }
    
            // Classify skills into Hard and Soft
            const hardSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Hard') || [];
            const softSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Soft') || [];
    
            // Check if Mid-Year IDP data exists to control access to 360 Degree Feedback steps
            const { data: midYearData, error: midYearError } = await supabase
                .from('midyearidps')
                .select('*')
                .eq('userId', user.userId)
                .eq('jobId', jobId)
                .eq('year', selectedYear)
                .single();
    
            if (midYearError) {
                console.error('Error fetching mid-year IDP data:', midYearError);
            }
    
            // Define viewState based on Mid-Year IDP data availability
            const viewState = {
                success: true,
                userId: user.userId,
                jobId,
                feedbacks: feedbackData,
                hardSkills,
                softSkills,
                objectiveQuestions,
                submittedObjectives,
                years: availableYears,
                selectedYear,
                viewOnlyStatus: {
                    objectivesettings: objectiveSettings.length > 0,
                    midyearidp: midYearData ? true : false,  // Set view-only if mid-year data exists
                    feedbacks_Q1: feedbackData['feedbacks_Q1']?.length > 0,
                    feedbacks_Q2: feedbackData['feedbacks_Q2']?.length > 0,
                    feedbacks_Q3: feedbackData['feedbacks_Q3']?.length > 0,
                    feedbacks_Q4: feedbackData['feedbacks_Q4']?.length > 0,
                },
            };
    
            // Function to calculate nextStep
// Function to calculate nextStep
function calculateNextStep(viewState) {
    let nextStep = null;

    if (!viewState.viewOnlyStatus.midyearidp) {
        nextStep = 1;  // Complete Mid-Year IDP
    } else if (!viewState.viewOnlyStatus.feedbacks_Q1) {
        nextStep = 2;  // Complete Q1 Feedback
    } else if (!viewState.viewOnlyStatus.feedbacks_Q2) {
        nextStep = 3;  // Complete Q2 Feedback
    } else if (!viewState.viewOnlyStatus.feedbacks_Q3) {
        nextStep = 4;  // Complete Q3 Feedback
    } else if (!viewState.viewOnlyStatus.feedbacks_Q4) {
        nextStep = 5;  // Complete Q4 Feedback
    }

    return nextStep;
}

// Add the nextStep to the viewState
viewState.nextAccessibleStep = calculateNextStep(viewState);

    
            console.log("View State:", viewState);
    
            res.render('staffpages/linemanager_pages/managerrecordsperftracker-user', { 
                viewState: viewState, 
                user, 
                nextAccessibleStep: viewState.nextAccessibleStep  // Include nextAccessibleStep here

            });
    
        } catch (error) {
            console.error('Error fetching user progress:', error);
            req.flash('errors', { fetchError: 'Error fetching user progress. Please try again.' });
            res.redirect('/linemanager/records-performance-tracker');
        }
    },    
    
    // getUserProgressView: async function(req, res) {
    //     const user = req.user;
    //     console.log('Fetching records for userId:', user?.userId);
    
    //     if (!user) {
    //         req.flash('errors', { authError: 'Unauthorized. Please log in to access this view.' });
    //         return res.redirect('/staff/login');
    //     }
    
    //     try {
    //         const { data: jobData, error: jobError } = await supabase
    //             .from('staffaccounts')
    //             .select('jobId')
    //             .eq('userId', user.userId)
    //             .single();
    
    //         if (jobError || !jobData) {
    //             console.error('Error fetching jobId:', jobError);
    //             req.flash('errors', { fetchError: 'Error fetching job information. Please try again.' });
    //             return res.redirect('/linemanager/records-performance-tracker');
    //         }
    
    //         const jobId = jobData.jobId;
    //         console.log('Fetched jobId:', jobId);
    
    //         const feedbackTables = ['feedbacks_Q1', 'feedbacks_Q2', 'feedbacks_Q3', 'feedbacks_Q4'];
    //         const yearPromises = feedbackTables.map(table => 
    //             supabase.from(table).select('year')
    //         );
    
    //         const yearResults = await Promise.all(yearPromises);
    //         const allYears = yearResults.flatMap(result => result.data || []);
    //         const availableYears = [...new Set(allYears.map(year => year.year))].sort((a, b) => b - a);
    //         const selectedYear = req.query.year || new Date().getFullYear();
    
    //         const feedbackData = {};
    //         for (const table of feedbackTables) {
    //             const { data, error } = await supabase
    //                 .from(table)
    //                 .select('*')
    //                 .eq('userId', user.userId)
    //                 .eq('jobId', jobId)
    //                 .eq('year', selectedYear);
    
    //             if (error) {
    //                 console.error(`Error fetching feedback data from ${table}:`, error);
    //                 req.flash('errors', { fetchError: `Error fetching data for ${table}. Please try again.` });
    //                 return res.redirect('/linemanager/records-performance-tracker');
    //             }
    
    //             feedbackData[table] = data;
    //         }
    
    //         console.log("Feedback Data:", feedbackData);
    
    //         // Fetch objectives settings
    //         const { data: objectiveSettings, error: objectivesError } = await supabase
    //             .from('objectivesettings')
    //             .select('*')
    //             .eq('userId', user.userId);
    
    //         if (objectivesError) {
    //             console.error('Error fetching objectives settings:', objectivesError);
    //             req.flash('errors', { fetchError: 'Error fetching objectives settings. Please try again.' });
    //             return res.redirect('/linemanager/records-performance-tracker');
    //         }
    
    //         let submittedObjectives = [];
    //         let objectiveQuestions = [];
    
    //         if (objectiveSettings.length > 0) {
    //             const objectiveSettingsIds = objectiveSettings.map(setting => setting.objectiveSettingsId);
    
    //             // Fetch the actual objectives related to the settings
    //             const { data: objectivesData, error: objectivesFetchError } = await supabase
    //                 .from('objectivesettings_objectives')
    //                 .select('*')
    //                 .in('objectiveSettingsId', objectiveSettingsIds);
    
    //             if (objectivesFetchError) {
    //                 console.error('Error fetching objectives:', objectivesFetchError);
    //                 req.flash('errors', { fetchError: 'Error fetching objectives. Please try again.' });
    //                 return res.redirect('/linemanager/records-performance-tracker');
    //             }
    
    //             submittedObjectives = objectivesData;
    
    //             // Fetch questions related to the objectives
    //             const { data: objectiveQuestionData, error: questionError } = await supabase
    //                 .from('feedbacks_questions-objectives')
    //                 .select('objectiveId, objectiveQualiQuestion')
    //                 .in('objectiveId', submittedObjectives.map(obj => obj.objectiveId));
    
    //             if (questionError) {
    //                 console.error('Error fetching objective questions:', questionError);
    //                 req.flash('errors', { fetchError: 'Error fetching objective questions. Please try again.' });
    //                 return res.redirect('/linemanager/records-performance-tracker');
    //             }
    
    //             objectiveQuestions = objectiveQuestionData;
    //         }
    
    //         // Map the `objectiveQuestions` to `submittedObjectives`
    //         submittedObjectives = submittedObjectives.map(obj => {
    //             const questions = objectiveQuestions.filter(q => q.objectiveId === obj.objectiveId);
    //             return {
    //                 ...obj,
    //                 objectiveQualiQuestion: questions.length > 0 ? questions.map(q => q.objectiveQualiQuestion).join(', ') : 'No questions available'
    //             };
    //         });
    
    //         // Fetch job requirements skills based on jobId
    //         const { data: skillsData, error: skillsError } = await supabase
    //             .from('jobreqskills')
    //             .select('jobReqSkillType, jobReqSkillName')
    //             .eq('jobId', jobId);
    
    //         if (skillsError) {
    //             console.error('Error fetching job requirements skills:', skillsError);
    //             req.flash('errors', { fetchError: 'Error fetching skills data. Please try again.' });
    //             return res.redirect('/linemanager/records-performance-tracker');
    //         }
    
    //         // Classify skills into Hard and Soft
    //         const hardSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Hard') || [];
    //         const softSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Soft') || [];
    
    //         // Initialize viewState
    //         const viewState = {
    //             success: true,
    //             userId: user.userId,
    //             jobId,
    //             feedbacks: feedbackData,
    //             hardSkills,
    //             softSkills,
    //             objectiveQuestions,
    //             submittedObjectives,
    //             years: availableYears,
    //             selectedYear,
    //             viewOnlyStatus: {
    //                 objectivesettings: objectiveSettings.length > 0,
    //             },
    //         };
    
    //         console.log("View State:", viewState);
    
    //         res.render('staffpages/linemanager_pages/managerrecordsperftracker-user', { viewState, user });
    //     } catch (error) {
    //         console.error('Error fetching user progress:', error);
    //         req.flash('errors', { fetchError: 'Error fetching user progress. Please try again.' });
    //         res.redirect('/linemanager/records-performance-tracker');
    //     }
    // },
    
    saveObjectiveSettings: async function(req, res) {
        try {
            const userId = req.body.userId;
            console.log("User ID in saveObjectiveSettings:", userId);
    
            const { jobId, objectiveDescrpt, objectiveKPI, objectiveTarget, objectiveUOM, objectiveAssignedWeight } = req.body;
    
            console.log("Request body:", req.body);
    
            if (!userId) {
                console.log("User not authenticated");
                return res.status(401).json({ success: false, message: "User not authenticated" });
            }
    
            // Get the current year
            const performancePeriodYear = new Date().getFullYear(); // Just the year
    
            // Initialize completeJobId
            let completeJobId = jobId;
    
            // Fetch from staffaccounts if jobId is missing
            if (!jobId) {
                console.log("Fetching missing jobId from staffaccounts table");
    
                const { data: staffAccountData, error } = await supabase
                    .from("staffaccounts")
                    .select("jobId")
                    .eq("userId", userId)
                    .single();
    
                if (error) {
                    console.error("Error fetching jobId:", error.message);
                    return res.status(500).json({ success: false, message: error.message });
                }
    
                completeJobId = staffAccountData?.jobId || jobId; // Fallback to existing jobId if staffAccountData is not found
            }
    
            // Check if jobId is still missing after fetching
            if (!completeJobId) {
                return res.status(400).json({ success: false, message: "Unable to retrieve jobId. Please provide it or ensure your user account has this information." });
            }
    
            // Validate objectives format
            const objectives = [];
            if (req.body.objectiveDescrpt) {
                for (let i = 0; i < req.body.objectiveDescrpt.length; i++) {
                    if (
                        req.body.objectiveDescrpt[i] && 
                        req.body.objectiveKPI[i] && 
                        req.body.objectiveTarget[i] && 
                        req.body.objectiveUOM[i] && 
                        req.body.objectiveAssignedWeight[i]
                    ) {
                        // Normalize weight to a decimal
                        const weight = parseFloat(req.body.objectiveAssignedWeight[i]) / 100;
    
                        objectives.push({
                            description: req.body.objectiveDescrpt[i],
                            kpi: req.body.objectiveKPI[i],
                            target: req.body.objectiveTarget[i],
                            uom: req.body.objectiveUOM[i],
                            weight: weight // Store normalized weight
                        });
                    }
                }
            }
    
            if (objectives.length === 0) {
                return res.status(400).json({ success: false, message: "Invalid objectives data format" });
            }
    
            console.log("Inserting data into objectivesettings table for user:", userId);
    
            const { data: objectiveSettingsData, error: objectiveSettingsError } = await supabase
                .from("objectivesettings")
                .insert({
                    userId,
                    jobId: completeJobId,
                    performancePeriodYear // Store only the year
                })
                .select("objectiveSettingsId");
    
            if (objectiveSettingsError) {
                console.error("Error inserting into objectivesettings table:", objectiveSettingsError.message);
                return res.status(500).json({ success: false, message: objectiveSettingsError.message });
            }
    
            const objectiveSettingsId = objectiveSettingsData[0].objectiveSettingsId;
            console.log("Objective Settings Inserted:", objectiveSettingsId);
    
            // Insert associated objectives into objectivesettings_objectives
            const objectiveEntries = objectives.map(objective => ({
                objectiveSettingsId,
                objectiveDescrpt: objective.description,
                objectiveKPI: objective.kpi,
                objectiveTarget: objective.target,
                objectiveUOM: objective.uom,
                objectiveAssignedWeight: objective.weight
            }));
    
            const { error: objectivesInsertError } = await supabase
                .from("objectivesettings_objectives")
                .insert(objectiveEntries);
    
            if (objectivesInsertError) {
                console.error("Error inserting objectives:", objectivesInsertError.message);
                return res.status(500).json({ success: false, message: objectivesInsertError.message });
            }
    
            res.redirect(`/linemanager/records-performance-tracker/${userId}`);
        } catch (error) {
            console.error("Error saving objective settings:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    },    

    save360DegreeFeedback: async function(req, res) {
        const { userId, startDate, endDate, jobId, feedbackData, quarter } = req.body;
    
        try {
            console.log("Entering save360DegreeFeedback function");
            console.log("User ID:", userId, "Request body:", req.body);
    
            // Step 1: Fetch the jobId if not provided
            let completeJobId = jobId;
            if (!completeJobId) {
                console.log("jobId is missing, fetching from staffaccounts...");
                const { data: staffAccountData, error } = await supabase
                    .from("staffaccounts")
                    .select("jobId")
                    .eq("userId", userId)
                    .single();
    
                if (error) {
                    console.error("Error fetching jobId:", error.message);
                    return res.status(500).json({ success: false, message: error.message });
                }
    
                if (!staffAccountData || !staffAccountData.jobId) {
                    console.error("No jobId found for the user.");
                    return res.status(400).json({ success: false, message: "Job ID not found for the user." });
                }
    
                completeJobId = staffAccountData.jobId;
                console.log("Fetched jobId:", completeJobId);
            }
    
            // Step 2: Validate required fields
            if (!completeJobId || !startDate || !endDate || !feedbackData || !feedbackData.questions.length || !quarter) {
                console.error('Validation error: Missing fields', { completeJobId, startDate, endDate, feedbackData, quarter });
                return res.status(400).json({ success: false, message: 'All fields are required.' });
            }
    
            // Determine the feedback table based on the quarter
            const feedbackTable = `feedbacks_${quarter}`;
            const feedbackKey = `feedback${quarter.toLowerCase()}_Id`;
    
            // Step 3: Check if feedback already exists
            const existingFeedback = await supabase
                .from(feedbackTable)
                .select('*')
                .eq('userId', userId)
                .eq('jobId', completeJobId)
                .eq('quarter', quarter)
                .eq('year', new Date().getFullYear())
                .single();
    
            let feedbackId;
            const dateCreated = new Date();
    
            if (existingFeedback.data) {
                console.log(`Updating existing feedback in ${feedbackTable}...`);
                const { error: updateError } = await supabase
                    .from(feedbackTable)
                    .update({
                        setStartDate: new Date(startDate),
                        setEndDate: new Date(endDate),
                        dateCreated: dateCreated,
                    })
                    .eq('userId', userId)
                    .eq('jobId', completeJobId)
                    .eq('quarter', quarter)
                    .eq('year', new Date().getFullYear());
    
                if (updateError) {
                    console.error(`Error updating feedback in ${feedbackTable}:`, updateError);
                    return res.status(500).json({ success: false, message: 'Error updating feedback. Please try again.', error: updateError });
                }
    
                feedbackId = existingFeedback.data[feedbackKey];
            } else {
                console.log(`Inserting new feedback into ${feedbackTable}...`);
                const { data: feedbackInsertData, error: feedbackInsertError } = await supabase
                    .from(feedbackTable)
                    .insert({
                        userId,
                        jobId: completeJobId,
                        setStartDate: new Date(startDate),
                        setEndDate: new Date(endDate),
                        dateCreated: dateCreated,
                        year: new Date().getFullYear(),
                        quarter: quarter
                    })
                    .select(feedbackKey);
    
                if (feedbackInsertError) {
                    console.error(`Error inserting into ${feedbackTable}:`, feedbackInsertError);
                    return res.status(500).json({ success: false, message: 'Error saving feedback. Please try again.', error: feedbackInsertError });
                }
    
                feedbackId = feedbackInsertData[0][feedbackKey];
            }
    
            // Step 4: Insert feedback mappings for questions
            for (const question of feedbackData.questions) {
                const { objectiveId, questionText } = question;
    
                const existingMapping = await supabase
                    .from('feedbacks_questions-objectives')
                    .select('*')
                    .eq(feedbackKey, feedbackId)
                    .eq('objectiveId', objectiveId)
                    .single();
    
                if (!existingMapping.data) {
                    console.log(`Inserting mapping for objectiveId=${objectiveId}`);
                    const { error: mappingInsertError } = await supabase
                        .from('feedbacks_questions-objectives')
                        .insert({
                            [feedbackKey]: feedbackId,
                            objectiveId,
                            objectiveQualiQuestion: questionText
                        });
    
                    if (mappingInsertError) {
                        console.error(`Error inserting feedback mapping:`, mappingInsertError);
                        return res.status(500).json({ success: false, message: 'Error inserting feedback mapping.', error: mappingInsertError });
                    }
                }
            }
    
            // Step 5: Fetch and map jobReqSkills
            const { data: jobReqSkills, error: skillFetchError } = await supabase
                .from('jobreqskills')
                .select('jobReqSkillId')
                .eq('jobId', completeJobId);
    
            if (skillFetchError) {
                console.error("Error fetching jobReqSkills:", skillFetchError.message);
                return res.status(500).json({ success: false, message: "Error fetching job skills." });
            }
    
            if (jobReqSkills && jobReqSkills.length > 0) {
                console.log("Mapping skills to feedback...");
                for (const jobReqSkill of jobReqSkills) {
                    const { jobReqSkillId } = jobReqSkill;
    
                    const existingSkillMapping = await supabase
                        .from('feedbacks_questions-skills')
                        .select('*')
                        .eq(feedbackKey, feedbackId)
                        .eq('jobReqSkillId', jobReqSkillId)
                        .single();
    
                    if (!existingSkillMapping.data) {
                        console.log(`Inserting skill mapping for jobReqSkillId=${jobReqSkillId}`);
                        const { error: skillMappingInsertError } = await supabase
                            .from('feedbacks_questions-skills')
                            .insert({
                                [feedbackKey]: feedbackId,
                                jobReqSkillId
                            });
    
                        if (skillMappingInsertError) {
                            console.error("Error inserting skill mapping:", skillMappingInsertError);
                            return res.status(500).json({ success: false, message: "Error inserting skill mapping." });
                        }
                    }
                }
            } else {
                console.error('No jobReqSkills found for the job.');
            }
    
            return res.status(200).json({ success: true, message: 'Feedback saved successfully.' });
        } catch (error) {
            console.error('Error in save360DegreeFeedback:', error);
            return res.status(500).json({ success: false, message: 'An error occurred.', error: error.message });
        }
    },

    getOffboardingRequestsDash: async function (req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
    
            if (!userId || req.session.user.userRole !== 'Line Manager') {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            // Fetch pending offboarding requests
            const { data: requests, error: requestsError } = await supabase
                .from('offboarding_requests')
                .select('requestId, userId, message, last_day, status, created_at')
                .eq('status', 'Pending Line Manager')
                .order('created_at', { ascending: false });
    
            if (requestsError) {
                console.error('Error fetching offboarding requests:', requestsError);
                req.flash('errors', { dbError: 'Failed to load offboarding requests.' });
                return res.redirect('/employee/dashboard');
            }
    
            if (!requests || requests.length === 0) {
                return res.render('staffpages/linemanager_pages/linemanageroffboarding', { requests: [] });
            }
    
            // Fetch employee names
            const userIds = requests.map(request => request.userId);
            const { data: staffAccounts, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, firstName, lastName')
                .in('userId', userIds);
    
            if (staffError) {
                console.error('Error fetching staff accounts:', staffError);
                req.flash('errors', { dbError: 'Failed to load employee names.' });
                return res.redirect('/employee/dashboard');
            }
    
            // Combine offboarding requests with staff details
            const requestsWithNames = requests.map(request => {
                const staff = staffAccounts.find(staff => staff.userId === request.userId);
                return {
                    ...request,
                    staffName: staff ? `${staff.firstName} ${staff.lastName}` : 'Unknown'
                };
            });
    
            res.render('staffpages/linemanager_pages/linemanageroffboarding', { requests: requestsWithNames });
        } catch (err) {
            console.error('Error in getOffboardingRequestsDash controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading offboarding requests.' });
            res.redirect('/employee/dashboard');
        }
    },
    
    getViewOffboardingRequest: async function (req, res) {
        const userId = req.params.userId;
    
        if (!userId) {
            return res.redirect('/staff/login');
        }
    
        try {
            const { data: requests, error } = await supabase
                .from('offboarding_requests')
                .select('requestId, message, last_day')
                .eq('userId', userId)
                .order('requestId', { ascending: false })
                .limit(1);
    
            if (error) {
                console.error('Error fetching offboarding request:', error);
                return res.redirect('/linemanager/dashboard');
            }
    
            if (!requests || requests.length === 0) {
                console.log('No offboarding request found for userId:', userId);
                return res.redirect('/linemanager/dashboard');
            }
    
            // Fetch staff details
            const { data: staff, error: staffError } = await supabase
                .from('staffaccounts')
                .select('firstName, lastName')
                .eq('userId', userId)
                .single();
    
            if (staffError) {
                console.error('Error fetching staff details:', staffError);
                req.flash('errors', { dbError: 'Failed to load staff details.' });
                return res.redirect('/linemanager/dashboard');
            }
    
            res.render('staffpages/linemanager_pages/viewoffboardingrequest', {
                request: requests[0],
                staffName: staff ? `${staff.firstName} ${staff.lastName}` : 'Unknown'
            });
        } catch (err) {
            console.error('Error in getViewOffboardingRequest controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the offboarding request.' });
            return res.redirect('/linemanager/dashboard');
        }
    },
    
    updateOffboardingRequest: async function (req, res) {
        console.log("Received request body:", req.body);
        const { requestId, action, reason } = req.body;
    
        try {
            // Only the 'acceptResignation' action exists now
            if (action !== 'acceptResignation') {
                return res.status(400).json({ success: false, message: 'Invalid action.' });
            }
    
            if (!reason) {
                return res.status(400).json({ success: false, message: 'Approval notes are required.' });
            }
    
            const updateData = {
                status: 'Pending HR',  
                line_manager_notes: reason, 
                line_manager_decision: 'Approved',
                accept_resignation: true
            };
    
            console.log("Updating with data:", { updateData, requestId });
    
            const { data, error } = await supabase
                .from('offboarding_requests')
                .update(updateData)
                .eq('requestId', requestId);  // Update by requestId
    
            console.log("Supabase response:", { data, error });
    
            if (error) {
                console.error('Error updating offboarding request:', error);
                return res.status(500).json({ success: false, message: 'Failed to update request status.', error: error.message });
            }
    
            return res.status(200).json({ success: true, message: 'Resignation accepted successfully.' });
    
        } catch (err) {
            console.error('Error in updateOffboardingRequest:', err);
            return res.status(500).json({ success: false, message: 'An error occurred while processing the request.', error: err.message });
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

    // Add this new method to check feedback submission status
checkFeedbackStatus: async function(req, res) {
    const { userId, quarter } = req.query;
    const currentUserId = req.session?.user?.userId;
    
    if (!userId || !quarter || !currentUserId) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters.'
        });
    }
    
    try {
        // Determine which feedback table to query based on quarter parameter
        let feedbackTable, feedbackIdField;
        
        if (quarter === 'Q1') {
            feedbackTable = 'feedbacks_Q1';
            feedbackIdField = 'feedbackq1_Id';
        } else if (quarter === 'Q2') {
            feedbackTable = 'feedbacks_Q2';
            feedbackIdField = 'feedbackq2_Id';
        } else if (quarter === 'Q3') {
            feedbackTable = 'feedbacks_Q3';
            feedbackIdField = 'feedbackq3_Id';
        } else if (quarter === 'Q4') {
            feedbackTable = 'feedbacks_Q4';
            feedbackIdField = 'feedbackq4_Id';
        } else {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid quarter specified.'
            });
        }
        
        // First get the feedback ID for this user
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(feedbackTable)
            .select(`${feedbackIdField}, userId`)
            .eq('userId', userId)
            .single();
            
        if (feedbackError || !feedbackData) {
            return res.status(404).json({ 
                success: false, 
                message: 'No feedback record found for this user.'
            });
        }
        
        const feedbackId = feedbackData[feedbackIdField];
        
        // Check if the current user has submitted answers for this feedback
        // First check objectives feedback
        const { data: objectiveAnswers, error: objectiveError } = await supabase
            .from('feedbacks_answers-objectives')
            .select('feedback_answerObjectivesId')
            .eq('feedback_qObjectivesId', feedbackId)
            .limit(1);
            
        if (!objectiveError && objectiveAnswers && objectiveAnswers.length > 0) {
            // Feedback has been submitted for objectives
            return res.status(200).json({
                success: true,
                submitted: true,
                message: 'Feedback has been submitted for this user.'
            });
        }
        
        // If no objective answers found, check for skill answers
        const { data: skillAnswers, error: skillError } = await supabase
            .from('feedbacks_answers-skills')
            .select('feedback_answerSkillsId')
            .eq('feedback_qSkillsId', feedbackId)
            .limit(1);
            
        if (!skillError && skillAnswers && skillAnswers.length > 0) {
            // Feedback has been submitted for skills
            return res.status(200).json({
                success: true,
                submitted: true,
                message: 'Feedback has been submitted for this user.'
            });
        }
        
        // If no answers found in either table, feedback has not been submitted
        return res.status(200).json({
            success: true,
            submitted: false,
            message: 'Feedback has not yet been submitted for this user.'
        });
        
    } catch (error) {
        console.error('Error in checkFeedbackStatus:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while checking feedback status.', 
            error: error.message 
        });
    }
},

// Modify the submitFeedback method to properly store feedback answers
submitFeedback: async function(req, res) {
    const { userId, feedbackId, quarter, reviewerUserId, objectives, hardSkills, softSkills } = req.body;
    
    if (!userId || !feedbackId || !quarter || !reviewerUserId) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters.' 
        });
    }
    
    try {
        // Determine which feedback table and field based on quarter
        let feedbackIdField;
        
        if (quarter === 'Q1') {
            feedbackIdField = 'feedbackq1_Id';
        } else if (quarter === 'Q2') {
            feedbackIdField = 'feedbackq2_Id';
        } else if (quarter === 'Q3') {
            feedbackIdField = 'feedbackq3_Id';
        } else if (quarter === 'Q4') {
            feedbackIdField = 'feedbackq4_Id';
        } else {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid quarter specified.' 
            });
        }
        
        // Process objectives feedback
        if (objectives && objectives.length > 0) {
            for (const objective of objectives) {
                const { objectiveId, quantitative, qualitative } = objective;
                
                // First get the feedback_qObjectivesId from the mapping table
                const { data: objectiveMapping, error: mappingError } = await supabase
                    .from('feedbacks_questions-objectives')
                    .select('feedback_qObjectivesId')
                    .eq(feedbackIdField, feedbackId)
                    .eq('objectiveId', objectiveId)
                    .single();
                    
                if (mappingError || !objectiveMapping) {
                    console.error('Error finding objective mapping:', mappingError);
                    continue; // Skip this objective if mapping not found
                }
                
                // Insert the feedback answer
                const { error: insertError } = await supabase
                    .from('feedbacks_answers-objectives')
                    .insert({
                        feedback_qObjectivesId: objectiveMapping.feedback_qObjectivesId,
                        objectiveQualInput: qualitative,
                        objectiveQuantInput: parseInt(quantitative),
                        created_at: new Date()
                    });
                    
                if (insertError) {
                    console.error('Error inserting objective feedback:', insertError);
                }
            }
        }
        
        // Process hard skills feedback
        if (hardSkills && hardSkills.length > 0) {
            await processSkillsFeedback(hardSkills, feedbackId, feedbackIdField);
        }
        
        // Process soft skills feedback
        if (softSkills && softSkills.length > 0) {
            await processSkillsFeedback(softSkills, feedbackId, feedbackIdField);
        }
        
        return res.status(200).json({
            success: true,
            message: 'Feedback submitted successfully.'
        });
        
    } catch (error) {
        console.error('Error in submitFeedback:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while submitting feedback.', 
            error: error.message 
        });
    }
},





/* ---------- NOTIFICATION DIVIDER ---------- */


getLeaveTypeName: async function(leaveTypeId) {
    try {
        // Query the leave types table to get the name
        const { data, error } = await supabase
            .from('leavetypes')
            .select('leaveTypeName')
            .eq('leaveTypeId', leaveTypeId)
            .single();
            
        if (error || !data) {
            console.log('Error getting leave type name:', error);
            return 'Leave';
        }
        
        return data.leaveTypeName || 'Leave';
    } catch (err) {
        console.error('Error in _getLeaveTypeName:', err);
        return 'Leave';
    }
},

getLineManagerNotifications: async function (req, res) {
    // Check for authentication
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Get the line manager's department ID first
        const lineManagerId = req.session.user.userId;
        const { data: lineManagerData, error: lineManagerError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', lineManagerId)
            .single();

        if (lineManagerError) {
            console.error('Error fetching line manager department:', lineManagerError);
            throw lineManagerError;
        }

        const lineManagerDepartmentId = lineManagerData?.departmentId;

        if (!lineManagerDepartmentId) {
            console.error('Line manager has no department assigned');
            return res.status(400).json({ error: 'Department not assigned to your account' });
        }

        // Fetch applicants awaiting Line Manager action (P1 status) 
        // Filter applicants by the line manager's department
        const { data: p1Applicants, error: p1ApplicantsError } = await supabase
            .from('applicantaccounts')
            .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId, departmentId')
            .eq('applicantStatus', 'P1 - Awaiting for Line Manager Action; HR PASSED')
            .eq('departmentId', lineManagerDepartmentId) // Filter by department ID
            .order('created_at', { ascending: false });

        if (p1ApplicantsError) throw p1ApplicantsError;

        // Fetch applicants awaiting Line Manager evaluation (P3 status) 
        // Filter applicants by the line manager's department
        const { data: p3Applicants, error: p3ApplicantsError } = await supabase
            .from('applicantaccounts')
            .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId, departmentId')
            .eq('applicantStatus', 'P3 - Awaiting for Line Manager Evaluation')
            .eq('departmentId', lineManagerDepartmentId) // Filter by department ID
            .order('created_at', { ascending: false });

        if (p3ApplicantsError) throw p3ApplicantsError;

        // Combine the applicants
        const allApplicants = [...p1Applicants, ...p3Applicants];

        // Format the applicants data
        const formattedApplicants = allApplicants.map(applicant => ({
            id: applicant.applicantId,
            firstName: applicant.firstName || 'N/A',
            lastName: applicant.lastName || 'N/A',
            status: applicant.applicantStatus || 'N/A',
            jobId: applicant.jobId, // Include jobId for the redirect
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

        // Fetch pending leave requests for staff in the line manager's department
        const { data: leaveRequests, error: leaveError } = await supabase
            .from('leaverequests')
            .select(`
                leaveRequestId, 
                userId, 
                created_at, 
                fromDate, 
                untilDate, 
                status,
                useraccounts (
                    userId, 
                    userEmail,
                    staffaccounts (
                        departmentId,
                        departments (deptName), 
                        lastName, 
                        firstName
                    )
                ), 
                leave_types (
                    typeName
                )
            `)
            .eq('status', 'Pending')
            .order('created_at', { ascending: false });

        if (leaveError) throw leaveError;

        // Filter leave requests to only include those from the line manager's department
        const filteredLeaveRequests = leaveRequests.filter(leave => 
            leave.useraccounts?.staffaccounts[0]?.departmentId === lineManagerDepartmentId
        );

        // Format leave requests
        const formattedLeaveRequests = filteredLeaveRequests.map(leave => ({
            userId: leave.userId,
            lastName: leave.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
            firstName: leave.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
            department: leave.useraccounts?.staffaccounts[0]?.departments?.deptName || 'N/A',
            filedDate: new Date(leave.created_at).toLocaleString('en-US', {
                weekday: 'short', 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric'
            }),
            type: leave.leave_types?.typeName || 'N/A',
            startDate: leave.fromDate || 'N/A',
            endDate: leave.untilDate || 'N/A',
            status: leave.status || 'Pending'
        }));

        // Calculate total notification count
        const notificationCount = formattedApplicants.length + formattedLeaveRequests.length;

        // If it's an API request, return JSON
        if (req.xhr || req.headers.accept?.includes('application/json') || req.path.includes('/api/')) {
            return res
                .header('Content-Type', 'application/json')
                .json({
                    applicants: formattedApplicants,
                    leaveRequests: formattedLeaveRequests,
                    notificationCount: notificationCount
                });
        }

        // Otherwise, return the rendered partial template
        return res.render('partials/linemanager_partials', {
            applicants: formattedApplicants,
            leaveRequests: formattedLeaveRequests,
            notificationCount: notificationCount
        });
    } catch (err) {
        console.error('Error fetching notification data:', err);
        
        // Better error handling for API requests
        if (req.xhr || req.headers.accept?.includes('application/json') || req.path.includes('/api/')) {
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
// Updated function to handle missing tables gracefully
get360FeedbackToast: async function(req, res) {
    try {
        console.log("Entering get360FeedbackToast function for line manager");

        // Step 1: Get today's date in the Philippines Time Zone (PHT)
        const today = new Date();
        const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(today);

        const todayString = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`;
        console.log(`Today's date (PHT): ${todayString}`);

        const feedbackTables = ['feedbacks_Q1', 'feedbacks_Q2', 'feedbacks_Q3', 'feedbacks_Q4']; 
        let activeFeedback = null;

        // Step 2: Fetch the current user's department ID
        const currentUserId = req.session?.user?.userId;

        if (!currentUserId) {
            console.log("Error: No user ID available in session.");
            return res.status(400).json({ success: false, message: 'User ID is required.' });
        }

        // Check if staffaccounts table exists and get department ID
        let departmentId;
        try {
            const { data: currentUserData, error: userError } = await supabase
                .from('staffaccounts')
                .select('departmentId')
                .eq('userId', currentUserId)
                .single();

            if (userError) {
                console.log("Error fetching user details:", userError);
                // If table doesn't exist, provide a fallback response
                if (userError.code === '42P01') { // Table doesn't exist
                    console.log("Staff accounts table does not exist yet");
                    return res.status(200).json({ 
                        success: true, 
                        feedback: {
                            setStartDate: new Date().toISOString(),
                            setEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
                            quarter: "Development"
                        }, 
                        quarter: "Development",
                        userId: currentUserId
                    });
                }
                return res.status(404).json({ success: false, message: 'User details not found.' });
            }

            if (!currentUserData) {
                console.log("No user data found");
                return res.status(404).json({ success: false, message: 'User details not found.' });
            }

            departmentId = currentUserData.departmentId;
        } catch (staffError) {
            console.error("Error accessing staff accounts:", staffError);
            // Return a development feedback in case tables are not set up
            return res.status(200).json({ 
                success: true, 
                feedback: {
                    setStartDate: new Date().toISOString(),
                    setEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
                    quarter: "Development"
                }, 
                quarter: "Development",
                userId: currentUserId
            });
        }

        // Step 3: Loop through each feedback table and fetch active feedback
        for (const feedbackTable of feedbackTables) {
            try {
                console.log(`Checking feedback table: ${feedbackTable}...`);

                // First check if the table exists
                const { error: tableCheckError } = await supabase
                    .from(feedbackTable)
                    .select('count')
                    .limit(1);

                if (tableCheckError && tableCheckError.code === '42P01') {
                    console.log(`Table ${feedbackTable} does not exist yet, skipping`);
                    continue;
                }

                const { data, error } = await supabase
                    .from(feedbackTable)
                    .select('*')
                    .lte('setStartDate', todayString) // Started today or earlier
                    .gte('setEndDate', todayString);  // Ends today or later

                if (error) {
                    console.log(`Error fetching data from ${feedbackTable}:`, error);
                    continue; 
                }

                if (data && data.length > 0) {
                    console.log(`Found ${data.length} active feedback entries in ${feedbackTable}`);

                    // Use the first active feedback found
                    activeFeedback = data[0];
                    const tableQuarter = feedbackTable.split('_')[1];
                    activeFeedback.quarter = tableQuarter;
                    break;
                } else {
                    console.log(`No active feedback found in ${feedbackTable}.`);
                }
            } catch (feedbackTableError) {
                // Log and continue to next table if there's an error
                console.log(`Error processing ${feedbackTable}:`, feedbackTableError);
            }
        }

        // Check if any active feedback record was found
        if (!activeFeedback) {
            console.log('No active feedback records found for the given date range.');
            return res.status(404).json({ 
                success: false, 
                message: 'No active feedback records found.' 
            });
        }

        return res.status(200).json({ 
            success: true, 
            feedback: activeFeedback, 
            quarter: activeFeedback.quarter,
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

getFeedbackUsers: async function(req, res) {
    const currentUserId = req.session?.user?.userId;
    const quarter = req.query.quarter || null;

    if (!currentUserId) {
        console.error("Error: No user ID available in session.");
        return res.status(400).json({ message: 'User ID is required.' });
    }

    try {
        // Your existing code...
        
        // Determine which feedback table to query based on quarter parameter
        let feedbackTable;
        let feedbackIdField;
        
        if (quarter === 'Q1') {
            feedbackTable = 'feedbacks_Q1';
            feedbackIdField = 'feedbackq1_Id';
        } else if (quarter === 'Q2') {
            feedbackTable = 'feedbacks_Q2';
            feedbackIdField = 'feedbackq2_Id';
        } else if (quarter === 'Q3') {
            feedbackTable = 'feedbacks_Q3';
            feedbackIdField = 'feedbackq3_Id';
        } else if (quarter === 'Q4') {
            feedbackTable = 'feedbacks_Q4';
            feedbackIdField = 'feedbackq4_Id';
        } else {
            // If no quarter specified, use today's date to determine the quarter
            const today = new Date();
            const month = today.getMonth() + 1; // getMonth() returns 0-11
            
            if (month <= 3) {
                feedbackTable = 'feedbacks_Q1';
                feedbackIdField = 'feedbackq1_Id';
            } else if (month <= 6) {
                feedbackTable = 'feedbacks_Q2';
                feedbackIdField = 'feedbackq2_Id';
            } else if (month <= 9) {
                feedbackTable = 'feedbacks_Q3';
                feedbackIdField = 'feedbackq3_Id';
            } else {
                feedbackTable = 'feedbacks_Q4';
                feedbackIdField = 'feedbackq4_Id';
            }
        }
        
        // Continue with your existing logic but focus on the selected quarter's table
        // ...
        
        // Continue with rest of your function
    } catch (error) {
        console.error('Error in getFeedbackUsers:', error);
        return res.status(500).json({ success: false, message: 'An error occurred while fetching feedback data.', error: error.message });
    }
},

    
};

module.exports = lineManagerController;
  // getSavedQuestionnaire: async function(req, res) {
    //     const { userId } = req.params; // Extract userId from request parameters
    //     const quarter = req.query.quarter; // Extract quarter from query parameters
    
    //     console.log('Received request to get saved questionnaire');
    //     console.log('User    ID:', userId);
    //     console.log('Quarter:', quarter);
    
    //     try {
    //         // Fetch feedbacks for the user
    //         console.log('Fetching feedback for userId:', userId);
    //         const { data: feedbackData, error: feedbackError } = await supabase
    //             .from('feedbacks')
    //             .select('*')
    //             .eq('userId', userId)
    //             .order('dateCreated', { ascending: false })
    //             .single(); // Assuming you want the latest feedback
    
    //         if (feedbackError) {
    //             console.error('Error fetching feedback:', feedbackError.message);
    //             return res.status(500).json({ success: false, message: 'Error fetching feedback. Please try again.' });
    //         }
    
    //         // Fetch objectives based on the feedback ID
    //         const { data: objectivesData, error: objectivesError } = await supabase
    //             .from('feedbacks_questions-objectives')
    //             .select('objectiveId, objectiveQualiQuestion')
    //             .eq('feedbackId', feedbackData.feedbackId);
    
    //         if (objectivesError) {
    //             console.error('Error fetching objectives:', objectivesError.message);
    //             return res.status(500).json({ success: false, message: 'Error fetching objectives. Please try again.' });
    //         }
    
    //         // Fetch skills based on the feedback ID
    //         const { data: skillsData, error: skillsError } = await supabase
    //             .from('feedbacks_questions-skills')
    //             .select('jobReqSkillId')
    //             .eq('feedbackId', feedbackData.feedbackId);
    
    //         if (skillsError) {
    //             console.error('Error fetching skills:', skillsError.message);
    //             return res.status(500).json({ success: false, message: 'Error fetching skills. Please try again.' });
    //         }
    
    //         // Structure the data for rendering
    //         const responseData = {
    //             feedback: {
    //                 question: feedbackData.question,
    //                 rating: feedbackData.rating,
    //                 qualitativeFeedback: feedbackData.qualitativeFeedback,
    //                 startDate: feedbackData.startDate,
    //                 endDate: feedbackData.endDate 
    //             },
    //             objectives: objectivesData.map(obj => ({
    //                 objectiveId: obj.objectiveId,
    //                 qualitativeQuestion: obj.objectiveQualiQuestion,
    //             })),
    //             skills: skillsData.map(skill => ({
    //                 jobReqSkillId: skill.jobReqSkillId,
    //             })),
    //         };
    
    //         // Return the structured data
    //         return res.json({ success: true, questionnaire: responseData });
    //     } catch (error) {
    //         console.error('Unexpected error:', error);
    //         return res.status(500).json({ success: false, message: 'An unexpected error occurred. Please try again.' });
    //     }
    // },
