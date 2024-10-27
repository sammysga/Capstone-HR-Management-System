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
                        userId, 
                        created_at, 
                        leaveTypeId, 
                        fromDate, 
                        untilDate, 
                        useraccounts (
                            userId, 
                            userEmail,
                            staffaccounts (
                                lastName, 
                                firstName
                            )
                        ), 
                        leave_types (
                            typeName
                        )
                    `)
                    .order('created_at', { ascending: false });
    
                if (leaveError) {
                    console.error('Error fetching leave requests:', leaveError);
                    req.flash('errors', { dbError: 'Error fetching leave requests.' });
                    return res.redirect('/linemanager/dashboard');
                }
    
                console.log('Leave Requests Data:', allLeaves); // Check leave requests data structure
    
                const formattedLeaves = allLeaves.map(leave => ({
                    lastName: leave.useraccounts?.staffaccounts[0]?.lastName || 'N/A', 
                    firstName: leave.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
                    filedDate: leave.created_at ? new Date(leave.created_at).toISOString().split('T')[0] : 'N/A',
                    type: leave.leave_types?.typeName || 'N/A',
                    startDate: leave.fromDate || 'N/A',
                    endDate: leave.untilDate || 'N/A'
                }));
    
                // Fetch attendance logs with department and job information
const { data: attendanceLogs, error: attendanceError } = await supabase
.from('attendance')
.select(`
    userId, 
    attendanceDate, 
    attendanceAction, 
    attendanceTime, 
    useraccounts (
        "userId", 
        staffaccounts (
            "staffId",
            "firstName", 
            "lastName",
            "departmentId", 
            "jobId",
            departments:departmentId ("deptName"),
            jobpositions:jobId ("jobTitle")
        )
    )
`)
.order('attendanceDate', { ascending: false });

if (attendanceError) {
console.error('Error fetching attendance logs:', attendanceError);
req.flash('errors', { dbError: 'Error fetching attendance logs.' });
return res.redirect('/linemanager/managerdashboard');
}

// Log the raw data for debugging
console.log('Raw Attendance Logs:', JSON.stringify(attendanceLogs, null, 2));

// Initialize an array to hold the formatted attendance logs
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

// Format the attendance logs for display
const formattedAttendanceDisplay = formattedAttendanceLogs.map(log => {
const activeWorkingHours = log.timeIn && log.timeOut ? (log.timeOut - log.timeIn) / 3600000 : 0;

const lastName = log.useraccounts?.staffaccounts?.[0]?.lastName || 'N/A';
const firstName = log.useraccounts?.staffaccounts?.[0]?.firstName || 'N/A';                        
const jobTitle = log.useraccounts?.staffaccounts?.[0]?.jobpositions?.jobTitle || 'N/A'; 
const departmentName = log.useraccounts?.staffaccounts?.[0]?.departments?.deptName || 'N/A';

return {
    department: departmentName,
    firstName,
    lastName,
    jobTitle,
    date: log.timeIn ? new Date(log.timeIn).toISOString().split('T')[0] : 'N/A',
    timeIn: log.timeIn ? log.timeIn.toLocaleTimeString() : 'N/A',
    timeOut: log.timeOut ? log.timeOut.toLocaleTimeString() : 'N/A',
    activeWorkingHours: activeWorkingHours.toFixed(2)
};
});

console.log('Formatted Attendance Logs:', formattedAttendanceDisplay);

res.render('staffpages/linemanager_pages/managerdashboard', {
formattedLeaves,
attendanceLogs: formattedAttendanceDisplay,
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
