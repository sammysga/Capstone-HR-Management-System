const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

const lineManagerController = {
    getLineManagerDashboard: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                // Fetch leave requests
                const { data: allLeaves, error: leaveError } = await supabase
                    .from('leaverequests')
                    .select(`
                        leaveRequestId, 
                        staffId, 
                        created_at, 
                        leaveTypeId, 
                        fromDate, 
                        untilDate, 
                        staffaccounts (lastName, firstName), 
                        leave_types (typeName)
                    `)
                    .order('created_at', { ascending: false });

                if (leaveError) {
                    console.error('Error fetching leave requests:', leaveError);
                    req.flash('errors', { dbError: 'Error fetching leave requests.' });
                    return res.redirect('/linemanager/dashboard');
                }

                // Format leave requests
                const formattedLeaves = allLeaves.map(leave => ({
                    lastName: leave.staffaccounts?.lastName || 'N/A',
                    firstName: leave.staffaccounts?.firstName || 'N/A',
                    filedDate: leave.created_at ? new Date(leave.created_at).toISOString().split('T')[0] : 'N/A',
                    type: leave.leave_types?.typeName || 'N/A',
                    startDate: leave.fromDate || 'N/A',
                    endDate: leave.untilDate || 'N/A'
                }));

                // Fetch attendance logs
                const { data: attendanceLogs, error: attendanceError } = await supabase
                    .from('attendance')
                    .select(`
                        staffId,
                        attendanceDate,
                        attendanceAction,
                        staffaccounts (
                            lastName,
                            firstName,
                            departmentId,
                            jobId
                        )
                    `)
                    .order('attendanceDate', { ascending: false });

                if (attendanceError) {
                    console.error('Error fetching attendance logs:', attendanceError);
                    req.flash('errors', { dbError: 'Error fetching attendance logs.' });
                    return res.redirect('/linemanager/dashboard');
                }

                const formattedAttendanceLogs = await Promise.all(attendanceLogs.map(async (attendance) => {
                    const attendanceDate = new Date(attendance.attendanceDate);
                    const attendanceAction = attendance.attendanceAction || 'N/A';
                
                    // Initialize variables
                    let timeIn = null;
                    let timeOut = null;
                    let activeWorkingHours = 0; // Initialize the variable here
                
                    // Check if attendanceTime exists and is a valid string
                    const attendanceTimeString = attendance.attendanceTime || '00:00:00'; // Default to '00:00:00' if undefined
                
                    // Split the time string to get hours, minutes, and seconds
                    const timeParts = attendanceTimeString.split(':');
                    if (timeParts.length === 3) {
                        const [hours, minutes, seconds] = timeParts.map(Number);
                        const localDate = new Date(attendanceDate.getFullYear(), attendanceDate.getMonth(), attendanceDate.getDate());
                
                        if (attendanceAction === 'Time In') {
                            timeIn = new Date(localDate.getTime() + (hours * 3600000) + (minutes * 60000) + (seconds * 1000));
                        } else if (attendanceAction === 'Time Out') {
                            timeOut = new Date(localDate.getTime() + (hours * 3600000) + (minutes * 60000) + (seconds * 1000));
                        }
                    } else {
                        console.error(`Invalid time format for attendance record: ${attendanceTimeString}`);
                        return null; // Handle this case as needed
                    }
                
                    // Calculate active working hours if both timeIn and timeOut are defined
                    if (timeIn && timeOut) {
                        activeWorkingHours = (timeOut - timeIn) / (1000 * 60 * 60); // Convert milliseconds to hours
                    }
                
                    // Format attendance time for display
                    const attendanceTime = timeIn ? timeIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false }) : 'N/A';
                    const timeOutDisplay = timeOut ? timeOut.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false }) : 'N/A';
                
                    return {
                        lastName: attendance.staffaccounts?.lastName || 'N/A',
                        firstName: attendance.staffaccounts?.firstName || 'N/A',
                        date: attendance.attendanceDate ? new Date(attendance.attendanceDate).toISOString().split('T')[0] : 'N/A',
                        department: await lineManagerController.getDepartmentName(attendance.staffaccounts?.departmentId),
                        jobPosition: await lineManagerController.getJobTitle(attendance.staffaccounts?.jobId),
                        attendanceTime: attendanceTime, // Time In
                        timeOut: timeOutDisplay, // Time Out
                        activeWorkingHours: activeWorkingHours.toFixed(2) // Active working hours
                    };
                }));

                // Render the dashboard with both leave requests and attendance logs
                res.render('staffpages/linemanager_pages/managerdashboard', { 
                    allLeaves: formattedLeaves,
                    attendanceLogs: formattedAttendanceLogs,
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors')
                });
            } catch (err) {
                console.error('Error fetching data for the dashboard:', err);
                req.flash('errors', { dbError: 'An error occurred while loading the dashboard.' });
                res.redirect('/linemanager/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    // Helper function to get department name
    getDepartmentName: async function(departmentId) {
        if (!departmentId) return 'N/A'; // Handle undefined departmentId
        const { data, error } = await supabase
            .from('departments')
            .select('deptName')
            .eq('departmentId', departmentId)
            .single();

        return error ? 'N/A' : data?.deptName || 'N/A';
    },
    
    // Helper function to get job title
    getJobTitle: async function(jobId) {
        if (!jobId) return 'N/A'; // Handle undefined jobId
        const { data, error } = await supabase
            .from('jobpositions')
            .select('jobTitle')
            .eq('jobId', jobId)
            .single();

        return error ? 'N/A' : data?.jobTitle || 'N/A';
    },
    
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
