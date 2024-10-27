const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

const lineManagerController = {
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
                        const activeWorkingHours = log.timeIn && log.timeOut ? (log.timeOut - log.timeIn) / 3600000 : 0;
    
                        return {
                            department: log.useraccounts?.staffaccounts[0]?.departments?.deptName || 'N/A',
                            firstName: log.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
                            lastName: log.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
                            jobTitle: log.useraccounts?.staffaccounts[0]?.jobpositions?.jobTitle || 'N/A',
                            date: log.timeIn ? new Date(log.timeIn).toISOString().split('T')[0] : 'N/A',
                            timeIn: log.timeIn ? log.timeIn.toLocaleTimeString() : 'N/A',
                            timeOut: log.timeOut ? log.timeOut.toLocaleTimeString() : 'N/A',
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
        // Check if the user is logged in and has the 'Line Manager' role
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                const userId = req.session.user.userId;
                const { userId: paramUserId } = req.params;
                const finalUserId = paramUserId || userId;
    
                console.log('Final User ID for query:', finalUserId);
    
                // Fetch leave request and related employee data
                const { data, error } = await supabase
                    .from('leaverequests')
                    .select(`
                        *,
                        useraccounts (
                            staffaccounts (
                                lastName,
                                firstName,
                                phoneNumber
                            )
                        ),
                        leave_types (
                            typeName
                        )
                    `)
                    .eq('userId', finalUserId) // Using finalUserId for the query
                    .single(); // Fetch a single record
    
                console.log('Supabase Query Result:', { data, error });
    
                // If no data is returned or there's an error
                if (error || !data) {
                    console.error('Error details:', error);
                    return res.status(404).json({ message: 'Leave request or employee not found.' }); // User-friendly message
                }
    
                // Construct the leave request object
                const leaveRequest = {
                    employeeName: `${data.useraccounts.staffaccounts.lastName} ${data.useraccounts.staffaccounts.firstName}`,
                    employeeContactNo: data.useraccounts.staffaccounts.phoneNumber,
                    leaveType: data.leave_types.typeName,
                    leaveStartDate: data.fromDate,
                    leaveStartDayType: data.fromDayType,
                    leaveEndDate: data.untilDate,
                    leaveEndDayType: data.untilDayType,
                    reason: data.reason,
                };
    
                console.log('Leave Request Object:', leaveRequest);
    
                // Render the view with leaveRequest data
                return res.render('staffpages/linemanager_pages/managerviewleaverequests', { leaveRequest });
    
            } catch (error) {
                console.error('Error fetching leave request:', error);
                return res.status(500).json({ success: false, message: 'Server error. Please try again later.' }); // User-friendly message
            }
        } else {
            return res.redirect('/login');
        }
    },
    
    updateLeaveRequest: async function(req, res) {
        const { leaveRequestId, action, remarks } = req.body;
    
        try {
            const updatedData = {
                remarkByManager: remarks,
                updatedDate: new Date(),
                status: action === 'approve' ? 'Approved' : 'Rejected'
            };
    
            const { data, error } = await supabase
                .from('leaverequests')
                .update(updatedData)
                .eq('leaveRequestId', leaveRequestId);
    
            if (error) {
                return res.status(400).json({ message: 'Failed to update leave request', error });
            }
    
            return res.redirect('/path/to/success/page');
        } catch (error) {
            console.error('Error updating leave request:', error);
            return res.status(500).json({ message: 'Server error' });
        }
    },
    
    
    // updateLeaveRequest: async function(req, res) {
    //     try {
    //         const { action, remarks, leaveRequestId } = req.body;
    
    //         // Validate input
    //         if (!action || !remarks || !leaveRequestId) {
    //             return res.status(400).json({ success: false, message: 'All fields are required.' });
    //         }
    
    //         // Update the leave request in Supabase
    //         const { error } = await supabase
    //             .from('leaverequests')
    //             .update({
    //                 status: action === 'approve' ? 'Approved' : 'Rejected', // Set the status based on the action
    //                 remarkByManager: remarks, // Save the manager's remarks
    //                 updatedDate: new Date().toISOString(), // Update the date
    //             })
    //             .eq('id', leaveRequestId); // Assuming id is the primary key for leave requests
    
    //         if (error) {
    //             return res.status(404).json({ success: false, message: 'Leave request not found.', error });
    //         }
    
    //         // Optionally, redirect to the leave requests page or render a confirmation view
    //         // res.redirect('/linemanager/leaverequests'); // Redirect if you have a route to list leave requests
    //         res.json({ success: true, message: 'Leave request updated successfully.' }); // Return success message as JSON
    
    //     } catch (error) {
    //         console.error('Error updating leave request:', error);
    //         res.status(500).json({ success: false, message: 'Server error.' });
    //     }
    // },
    
    getUserAccount: async function (req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
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
                lastName: staff.lastName
            };

            res.render('staffpages/linemanager_pages/manageruseraccount', { user: userData });
        } catch (err) {
            console.error('Error in getUserAccount controller:', err);
            req.flash('errors', { dbError: 'An error occured while loading the account page.' });
            res.redirect('/linemanager/dashboard');
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

    getMRF: function(req, res){
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/mrf');
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
            justification: req.body.justification,
            requiredAttachments: req.body.requiredAttachments ? req.body.requiredAttachments.join(', ') : '', // Convert array to string
            userId: req.session.user.userId,
        };
    
        try {
            const { data: mrf, error } = await supabase
                .from('mrf')
                .insert([mrfData]);
    
            if (error) {
                throw error;
            }
    
            req.flash('success', { message: 'MRF Request submitted successfully!' });
            return res.redirect('/linemanager/mrf');
        } catch (error) {
            console.error(error);
            req.flash('errors', { submissionError: 'Failed to submit MRF. Please try again.' });
            return res.redirect('/linemanager/request-mrf');
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
