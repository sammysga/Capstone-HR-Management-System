const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

const lineManagerController = {
    getLineManagerDashboard: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                const { data: allLeaves, error } = await supabase
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
    
                if (error) {
                    console.error('Error fetching leave requests:', error);
                    req.flash('errors', { dbError: 'Error fetching leave requests.' });
                    return res.redirect('/linemanager/dashboard');
                }
    
                // Check if allLeaves contains data
                if (!allLeaves || allLeaves.length === 0) {
                    console.log('No leave requests found in the database.');
                }
    
                // Format the leave requests to only include necessary fields
                const formattedLeaves = allLeaves.map(leave => ({
                    lastName: leave.staffaccounts?.lastName || 'N/A',
                    firstName: leave.staffaccounts?.firstName || 'N/A',
                    filedDate: leave.created_at ? new Date(leave.created_at).toISOString().split('T')[0] : 'N/A', // Format date correctly
                    type: leave.leave_types?.typeName || 'N/A',
                    startDate: leave.fromDate || 'N/A',
                    endDate: leave.untilDate || 'N/A'
                }));
    
                // Render the dashboard with the formatted leave requests
                res.render('staffpages/linemanager_pages/managerdashboard', { 
                    allLeaves: formattedLeaves,
                    successMessage: req.flash('success'), // Success message handling
                    errorMessage: req.flash('errors') // Error message handling
                });
            } catch (err) {
                console.error('Error fetching leave requests:', err);
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

    getRequestMRF: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/request-mrf');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
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
