const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const { getISOWeek } = require('date-fns');



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
    

    // Fetch notifications from Supabase for Line Manager Dashboard
getLineManagerNotifications: async function (req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null; // Ensure user is authenticated
        if (!userId) {
            req.flash('errors', { authError: 'User not logged in.' });
            return res.redirect('/staff/login');
        }

        // Fetch notifications from 'applicantaccounts'
        const { data: applicants, error } = await supabase
            .from('applicantaccounts')
            .select('firstName, lastName, applicantStatus, created_at')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching notifications:', error);
            req.flash('errors', { dbError: 'Error retrieving notifications.' });
            return res.redirect('/staff/managerdashboard');
        }

        // Transform the data for the front-end
        const notifications = applicants.map(applicant => ({
            firstName: applicant.firstName,
            lastName: applicant.lastName,
            applicantStatus: applicant.applicantStatus,
            date: applicant.created_at,
            employeePhoto: "/images/profile.png", // Placeholder, update if actual image exists
            headline: applicant.applicantStatus === "P1 - Awaiting for Line Manager Action; HR PASSED"
                ? "Awaiting Your Approval"
                : "New Application Received",
            content: applicant.applicantStatus === "P1 - Awaiting for Line Manager Action; HR PASSED"
                ? `Required Line Manager Action for ${applicant.firstName} ${applicant.lastName}`
                : `${applicant.firstName} ${applicant.lastName} submitted an application.`
        }));

        // Render the manager dashboard with notifications
        res.render('staffpages/linemanager_pages/managerdashboard', { 
            notifications,
            successMessage: req.flash('success'),
            errorMessage: req.flash('errors')
        });

    } catch (err) {
        console.error('Error in getLineManagerNotifications controller:', err);
        req.flash('errors', { dbError: 'An unexpected error occurred while loading notifications.' });
        res.redirect('/staff/managerdashboard');
    }
},

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
                return res.redirect('/linemanager/dashboard');
            }
    
            const userData = {
                ...user,
                firstName: staff.firstName,
                lastName: staff.lastName,
                phoneNumber: '123-456-7890', // Dummy phone number
                dateOfBirth: '1990-01-01', // Dummy date of birth
                emergencyContact: 'Jane Doe (123-456-7890)' // Dummy emergency contact
            };
    
            res.render('staffpages/linemanager_pages/managerpersinfocareerprog', { user: userData });
        } catch (err) {
            console.error('Error in getPersInfoCareerProg controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the page.' });
            res.redirect('/linemanager/managerdashboard');
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
                return res.redirect('staffpages/linemanager_pages/managerpersinfocareerprog');
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
                return res.redirect('staffpages/linemanager_pages/managerpersinfocareerprog');
            }
    
            req.flash('success', { updateSuccess: 'User information updated successfully!' });
            res.redirect('staffpages/linemanager_pages/managerpersinfocareerprog');
    
        } catch (err) {
            console.error('Error in updateUserInfo controller:', err);
            req.flash('errors', { dbError: 'An error occurred while updating the information.' });
            res.redirect('staffpages/linemanager_pages/managerpersinfocareerprog');
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
    
                // Log final counts for each jobId
                console.log('Status Counts Map:', statusCountsMap);
    
                // Merge counts into job positions
                const jobPositionsWithCounts = jobpositions.map((job) => ({
                    ...job,
                    departmentName: departments.find(dept => dept.departmentId === job.departmentId)?.deptName || 'Unknown',
                    counts: statusCountsMap[job.jobId] || { P1: 0, P2: 0, P3: 0, Offered: 0, Onboarding: 0 },
                }));
    
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
res.render('staffpages/linemanager_pages/linemanagerapplicanttracking-jobposition', { applicants });
            } catch (error) {
                console.error('Error fetching applicants:', error);
                res.status(500).json({ error: 'Error fetching applicants' });
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized access. Line Manager role required.' });
            res.redirect('/staff/login');
        }
    },

    updateP1LineManagerPassed: async function(req, res) {
        const { userId } = req.body; // Only get userId from request body
    
        try {
            // Update `applicant_initialscreening_assessment` using `userId`
            const { error: assessmentError } = await supabase
                .from('applicant_initialscreening_assessment')
                .update({ isLineManagerChosen: true })
                .eq('userId', userId);
            
            if (assessmentError) throw assessmentError;
    
            // Update `applicantaccounts` using `userId`
            const { error: statusError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: "P1 - PASSED" })
                .eq('userId', userId);
            
            if (statusError) throw statusError;
    
            res.json({ success: true, message: "Applicant status updated successfully.", userId });
        } catch (error) {
            res.json({ success: false, message: error.message });
        }
    },

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
                .from('midyearidp')
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
