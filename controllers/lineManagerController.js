const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

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
                        userId: leave.userId, // Include userId here
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
                const formatAttendanceLogs = (attendanceLogs) => {
                    const formattedAttendanceLogs = attendanceLogs.reduce((acc, attendance) => {
                        const attendanceDate = attendance.attendanceDate;
                        const attendanceTime = attendance.attendanceTime || '00:00:00';
                        const [hours, minutes, seconds] = attendanceTime.split(':').map(Number);
                        const localDate = new Date(attendanceDate);
                        localDate.setHours(hours, minutes, seconds);
                
                        const userId = attendance.userId;
                        const existingEntry = acc.find(log => log.userId === userId && log.date === attendanceDate);
                
                        if (attendance.attendanceAction === 'Time In') {
                            if (existingEntry) {
                                existingEntry.timeIn = localDate;
                            } else {
                                acc.push({
                                    userId,
                                    date: attendanceDate,
                                    timeIn: localDate,
                                    timeOut: null,
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
                            activeWorkingHours: activeWorkingHours.toFixed(2)
                        };
                    });
                };
                // Fetch formatted leave data
                const formattedAllLeaves = await fetchAndFormatLeaves();
                const formattedApprovedLeaves = await fetchAndFormatLeaves('Approved');
                const attendanceLogs = await fetchAttendanceLogs();
                const formattedAttendanceDisplay = formatAttendanceLogs(attendanceLogs);
    
                // Render the dashboard with all relevant data
                return res.render('staffpages/linemanager_pages/managerdashboard', { 
                    allLeaves: formattedAllLeaves,
                    approvedLeaves: formattedApprovedLeaves,
                    attendanceLogs: formattedAttendanceDisplay,
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors')
                });
            } catch (err) {
                console.error('Error fetching data for the dashboard:', err);
                req.flash('errors', { dbError: 'An error occurred while loading the dashboard.' });
                return res.redirect('/linemanager/dashboard');
            }
        } else {
            // Redirect or handle unauthorized access here if needed
            return res.redirect('/login');
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

    getApplicantTracker: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/linemangerapplicanttracking');
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
                certifications: userData.staffaccounts[0]?.staffcertification || []
            };
    
            req.user = formattedUserData;
            next();
        } catch (err) {
            console.error('Error in getRecordsPerformanceTrackerByUserId controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the personal info page.' });
            res.redirect('/staffpages/linemanager_pages/managerrecordsperftracker');
        }
    },
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
    
            // Fetch feedbacks across quarters
            const feedbackTables = ['feedbacks_Q1', 'feedbacks_Q2', 'feedbacks_Q3', 'feedbacks_Q4'];
            const feedbackData = {};
    
            for (const table of feedbackTables) {
                const { data, error } = await supabase
                    .from(table)
                    .select('*')
                    .eq('userId', user.userId)
                    .eq('jobId', jobId);
    
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
                    .from('feedbacks_questions-objectives')  // Ensure this table name is correct
                    .select('objectiveId, objectiveQualiQuestion')  // Include objectiveId
                    .in('objectiveId', submittedObjectives.map(obj => obj.objectiveId));  // Ensure you are filtering by objectiveId
    
                if (questionError) {
                    console.error('Error fetching objective questions:', questionError);
                    req.flash('errors', { fetchError: 'Error fetching objective questions. Please try again.' });
                    return res.redirect('/linemanager/records-performance-tracker');
                }
    
                objectiveQuestions = objectiveQuestionData;  // This should now contain objectiveId and question
            }
    
            // Now, map the `objectiveQuestions` to `submittedObjectives`
            submittedObjectives = submittedObjectives.map(obj => {
                const question = objectiveQuestions.find(q => q.objectiveId === obj.objectiveId);
                return {
                    ...obj,
                    objectiveQualiQuestion: question ? question.objectiveQualiQuestion : 'No question available'
                };
            });
    
            // Fetch job requirements skills based on jobId
            const { data: skillsData, error: skillsError } = await supabase
                .from('jobreqskills')
                .select('jobReqSkillType, jobReqSkillName')
                .eq('jobId', jobId);
    
            if (skillsError) {
                console.error('Error fetching job requirements skills:', skillsError);
                req.flash('errors', { fetchError : 'Error fetching skills data. Please try again.' });
                return res.redirect('/linemanager/records-performance-tracker');
            }
    
            // Classify skills into Hard and Soft
            const hardSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Hard') || [];
            const softSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Soft') || [];
            console.log("Classified Hard Skills:", hardSkills);
            console.log("Classified Soft Skills:", softSkills);
    
            // Example logic to fetch skill questions (extend as needed)
            const skillQuestions = []; // Add skill question fetch logic here
            console.log("Skill Questions:", skillQuestions);
    
            // Feedback answers - placeholder for fetch logic
            const feedbackAnswers = []; // Add feedback answer fetch logic here
    
            // Initialize viewState
            const viewState = {
                success: true,
                userId: user.userId,
                jobId,
                feedbacks: feedbackData,
                hardSkills,
                softSkills,
                skillQuestions,
                objectiveQuestions,
                feedbackAnswers,
                viewOnlyStatus: {
                    objectivesettings: objectiveSettings.length > 0,
                },
                submittedObjectives,
            };
    
            console.log("View State:", viewState);
    
            res.render('staffpages/linemanager_pages/managerrecordsperftracker-user', { viewState, user });
        } catch (error) {
            console.error('Error fetching user progress:', error);
            req.flash('errors', { fetchError: 'Error fetching user progress. Please try again.' });
            res.redirect('/linemanager/records-performance-tracker');
        }
    },
    
    saveObjectiveSettings: async function(req, res) {
        try {
            const userId = req.body.userId;
            console.log("User  ID in saveObjectiveSettings:", userId);
    
            const { jobId, objectiveDescrpt, objectiveKPI, objectiveTarget, objectiveUOM, objectiveAssignedWeight } = req.body;
    
            console.log("Request body:", req.body);
    
            if (!userId) {
                console.log("User  not authenticated");
                return res.status(401).json({ success: false, message: "User   not authenticated" });
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
                    if (req.body.objectiveDescrpt[i] && req.body.objectiveKPI[i] && req.body.objectiveTarget[i] && req.body.objectiveUOM[i] && req.body.objectiveAssignedWeight[i]) {
                        objectives.push({
                            description: req.body.objectiveDescrpt[i],
                            kpi: req.body.objectiveKPI[i],
                            target: req.body.objectiveTarget[i],
                            uom: req.body.objectiveUOM[i],
                            weight: req.body.objectiveAssignedWeight[i]
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
    
            res.json({ success: true, message: "Objective settings saved successfully!" });
        } catch (error) {
            console.error("Error saving objective settings:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    },    
    saveObjectiveSettings: async function(req, res) {
        try {
            const userId = req.body.userId;
            console.log("User  ID in saveObjectiveSettings:", userId);
    
            const { jobId, objectiveDescrpt, objectiveKPI, objectiveTarget, objectiveUOM, objectiveAssignedWeight } = req.body;
    
            console.log("Request body:", req.body);
    
            if (!userId) {
                console.log("User  not authenticated");
                return res.status(401).json ({ success: false, message: "User   not authenticated" });
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
                    if (req.body.objectiveDescrpt[i] && req.body.objectiveKPI[i] && req.body.objectiveTarget[i] && req.body.objectiveUOM[i] && req.body.objectiveAssignedWeight[i]) {
                        objectives.push({
                            description: req.body.objectiveDescrpt[i],
                            kpi: req.body.objectiveKPI[i],
                            target: req.body.objectiveTarget[i],
                            uom: req.body.objectiveUOM[i],
                            weight: req.body.objectiveAssignedWeight[i]
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
                    performancePeriodYear // Stosre only the year
                })
                .select("objectiveSettingsId");
    
            if (objectiveSettingsError) {
                console.error("Error inserting into objectivesettings table:", objectiveSettingsError.message);
                return res.status(500).json({ success: false, message: objectiveSettingsError.message });
            }
    
            const objectiveSettingsId = objectiveSettingsData[0].objectiveSettingsId;
            console.log("Objective settings ID generated:", objectiveSettingsId);
    
            const objectivesData = objectives.map(obj => ({
                objectiveSettingsId,
                objectiveDescrpt: obj.description,
                objectiveKPI: obj.kpi,
                objectiveTarget: obj.target,
                objectiveUOM: obj.uom,
                objectiveAssignedWeight: parseFloat(obj.weight.replace("%", "")) / 100 // Convert "75%" to 0.75
            }));
    
            console.log("Prepared objectives data for insertion:", objectivesData);
    
            const { error: objectivesError } = await supabase
                .from("objectivesettings_objectives")
                .insert(objectivesData);
    
            if (objectivesError) {
                console.error("Error inserting into objectivesettings_objectives table:", objectivesError.message);
                return res.status(500).json({ success: false, message: objectivesError.message });
            }
    
            console.log("Objectives saved successfully.");
            // Redirecting to the view-only page after saving objectives
            res.redirect(`/linemanager/records-performance-tracker/${userId}`); // Redirect to the view-only page
    
        } catch (error) {
            console.error("Error saving objective settings:", error);
            res.status(500).json({ success: false, message: "An error occurred while saving data" });
     }
    },
    
    saveQ1_360DegreeFeedback: async function(req, res) {
        const { userId, startDate, endDate, jobId, feedbackData } = req.body;
    
        try {
            console.log("Entering saveQ1_360DegreeFeedback function");
            console.log("User ID:", userId, "Request body:", req.body);
    
            // Fetch jobId if missing
            let completeJobId = jobId;
            if (!jobId) {
                console.log("Job ID is missing, fetching from staffaccounts...");
                const { data: staffAccountData, error } = await supabase
                    .from("staffaccounts")
                    .select("jobId")
                    .eq("userId", userId)
                    .single();
    
                if (error) {
                    console.error("Error fetching jobId:", error.message);
                    return res.status(500).json({ success: false, message: error.message });
                }
                completeJobId = staffAccountData?.jobId || jobId;
                console.log("Fetched jobId:", completeJobId);
            }
    
            // Validate required fields
            if (!completeJobId || !startDate || !endDate || !feedbackData || !feedbackData.questions.length) {
                console.error('Validation error: Missing fields', { completeJobId, startDate, endDate, feedbackData });
                return res.status(400).json({ success: false, message: 'All fields are required.' });
            }
    
            // Insert feedback into 360degreefeedbacks
            console.log("Inserting feedback into 360degreefeedbacks...");
            const { data: feedbackInsertData, error: feedbackInsertError } = await supabase
                .from('feedbacks')
                .insert({
                    userId,
                    jobId: completeJobId,
                    setStartDate: new Date(startDate),
                    setEndDate: new Date(endDate),
                    dateCreated: new Date(),
                    year: new Date().getFullYear(),
                    quarter: 'Q1'
                })
                .select("feedbackId");
    
            if (feedbackInsertError) {
                console.error('Error inserting into 360degreefeedbacks:', feedbackInsertError);
                return res.status(500).json({ success: false, message: 'Error saving feedback. Please try again.' });
            }
    
            const feedbackId = feedbackInsertData[0].feedbackId;
            console.log('Feedback ID generated:', feedbackId);
    
            // Fetch objectiveSettingsId based on userId
            console.log("Fetching objectivesettingsId for userId:", userId);
            const { data: objectiveSettingsData, error: objectiveSettingsError } = await supabase
                .from("objectivesettings")
                .select("objectiveSettingsId")
                .eq("userId", userId)
                .single();
    
            if (objectiveSettingsError) {
                console.error("Error fetching objectivesettingsId:", objectiveSettingsError.message);
                return res.status(500).json({ success: false, message: objectiveSettingsError.message });
            }
    
            const objectiveSettingsId = objectiveSettingsData?.objectiveSettingsId;
            console.log("Fetched objectiveSettingsId:", objectiveSettingsId);
    
            // Fetch corresponding objectives (objectiveId) from objectivesettings_objectives
            console.log("Fetching objectives from objectivesettings_objectives...");
            const { data: objectivesData, error: objectivesError } = await supabase
                .from("objectivesettings_objectives")
                .select("objectiveId")
                .eq("objectiveSettingsId", objectiveSettingsId);
    
            if (objectivesError) {
                console.error("Error fetching objectives:", objectivesError.message);
                return res.status(500).json({ success: false, message: 'Error fetching objectives. Please try again.' });
            }
    
            console.log("Fetched objectives for objectiveSettingsId:", objectivesData);
    
            // Insert each objective individually
            for (const [index, objective] of objectivesData.entries()) {
                const objectiveId = objective.objectiveId;
            
                // Ensure that we get the correct qualitative question
                const objectiveQualiQuestion = feedbackData.questions[index]?.qualitativeQuestion || `Default question for objective ${objectiveId}`;
            
                console.log(`Attempting to insert mapping: feedbackId=${feedbackId}, objectiveId=${objectiveId}, objectiveQualiQuestion="${objectiveQualiQuestion}"`);
            
                // Insert the individual mapping into 360degreefeedbacks_questions-objectives table
                const { error: individualInsertError } = await supabase
                    .from('feedbacks_questions-objectives')
                    .insert({
                        feedbackId,
                        objectiveId,
                        objectiveQualiQuestion: objectiveQualiQuestion
                    });
            
                if (individualInsertError) {
                    console.error("Error inserting feedback mapping:", individualInsertError);
                    return res.status(500).json({ success: false, message: individualInsertError.message || 'Error saving feedback mapping. Please try again.' });
                }
            
                console.log(`Successfully inserted mapping for feedbackId=${feedbackId} and objectiveId=${objectiveId}`);
            }
    
            // Fetch skills based on userId
            console.log("Fetching skills for userId:", userId);
            const { data: skillsData, error: skillsError } = await supabase
                .from("jobreqskills")
            .select("jobReqSkillId")
            .eq("jobId", jobId);  // use the correct column name here

    
            if (skillsError) {
                console.error("Error fetching skills:", skillsError.message);
                return res.status(500).json({ success: false, message: 'Error fetching skills. Please try again.' });
            }
    
            console.log("Fetched skills for userId:", skillsData);
    
            // Insert each skill individually
            for (const skill of skillsData) {
                const jobReqSkillId = skill.jobReqSkillId;
    
                // Attempt to insert the mapping into the 360degreefeedbacks_questions-skills table
                console.log(`Attempting to insert mapping: feedbackId=${feedbackId}, jobReqSkillId=${jobReqSkillId}`);
    
                // Insert the individual mapping into 360degreefeedbacks_questions-skills table
                const { error: skillInsertError } = await supabase
                    .from("feedbacks_questions-skills")
                    .insert({
                        feedbackId,
                        jobReqSkillId
                    });
    
                if (skillInsertError) {
                    console.error("Error inserting skill mapping:", skillInsertError);
                    return res.status(500).json({ success: false, message: skillInsertError.message || 'Error saving skill mapping. Please try again.' });
                }
    
                console.log(`Successfully inserted mapping for feedbackId=${feedbackId} and jobReqSkillId=${jobReqSkillId}`);
            }
    
            // If all inserts were successful
            console.log("All feedback mappings and skills inserted successfully.");
            return res.status(200).json({ success: true, message: 'Feedback and skills saved successfully.' });
    
        } catch (error) {
            console.error("Unexpected error:", error);
            return res.status(500).json({ success: false, message: 'An unexpected error occurred. Please try again.' });
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
