const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

const employeeController = {
    getEmployeeDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Employee') {
            res.render('staffpages/employee_pages/employeedashboard');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
            res.redirect('/staff/login');
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
            .select('firstName, lastName')
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
            lastName: staff.lastName
        };

        res.render('staffpages/employee_pages/useracc', { user: userData });
    } catch (err) {
        console.error('Error in getUserAccount controller:', err);
        req.flash('errors', { dbError: 'An error occurred while loading the account page.' });
        res.redirect('/staff/employee/dashboard');
    }
},

// Password reset controller function
resetPassword: async function(req, res) {
    try {
        const userId = req.session.user.userId; // Assuming userId is stored in session
        const { newPassword, confirmPassword } = req.body;

        // Ensure passwords match
        if (newPassword !== confirmPassword) {
            req.flash('errors', { passwordError: 'Passwords do not match.' });
            return res.redirect('/staff/employee/useracc');
        }

        // Hash the new password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update password in database
        const { error } = await supabase
            .from('useraccounts')
            .update({ userPass: hashedPassword })
            .eq('userId', userId);

        if (error) {
            console.error('Error updating password:', error);
            req.flash('errors', { dbError: 'Error updating password.' });
            return res.redirect('/staff/employee/useracc');
        }

        req.flash('success', 'Password updated successfully!');
        res.redirect('/staff/employee/useracc');
    } catch (err) {
        console.error('Error in resetPassword controller:', err);
        req.flash('errors', { dbError: 'An error occurred while updating the password.' });
        res.redirect('/staff/employee/useracc');
    }
},

updateUserInfo: async function(req, res) {
    try {
        const userId = req.session.user.userId; // Assuming userId is stored in session
        const { firstName, lastName, userEmail } = req.body;

        // Update the user info in both 'useraccounts' and 'staffaccounts' tables
        const { error: userError } = await supabase
            .from('useraccounts')
            .update({ userEmail }) // This line updates the email
            .eq('userId', userId);

        const { error: staffError } = await supabase
            .from('staffaccounts')
            .update({ firstName, lastName })
            .eq('userId', userId);

        if (userError || staffError) {
            console.error('Error updating user information:', userError || staffError);
            req.flash('errors', { dbError: 'Error updating user information.' });
            return res.redirect('/employee/useracc');
        }

        req.flash('success', 'User information updated successfully!');
        res.redirect('/employee/useracc');
    } catch (err) {
        console.error('Error in updateUserInfo controller:', err);
        req.flash('errors', { dbError: 'An error occurred while updating the information.' });
        res.redirect('/employee/useracc');
    }
},


getPersInfoCareerProg: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null; // Get the user ID from the session
        if (!userId) {
            req.flash('errors', { authError: 'User not logged in.' });
            return res.redirect('/staff/login');
        }

        // Fetch user email and role from useraccounts table
        const { data: user, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail, userRole')
            .eq('userId', userId);

        // Fetch firstName and lastName from staffaccounts table
        const { data: staff, error: staffError } = await supabase
            .from('staffaccounts')
            .select('firstName, lastName')
            .eq('userId', userId);

        if (userError || staffError) {
            console.error('Error fetching user or staff details:', userError || staffError);
            req.flash('errors', { dbError: 'Error fetching user data.' });
            return res.redirect('/employee/useracc');
        }

        const userData = {
            userEmail: user[0]?.userEmail || '',
            userRole: user[0]?.userRole || '',
            firstName: staff[0]?.firstName || '',
            lastName: staff[0]?.lastName || ''
        };

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

getEmployeeOffboarding: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        // Fetch user-specific data if needed, or any offboarding-related details
        const { data: user, error } = await supabase
            .from('useraccounts')
            .select('userEmail, userRole')
            .eq('userId', userId)
            .single();

        if (error) {
            console.error('Error fetching user details:', error);
            req.flash('errors', { dbError: 'Error fetching user data.' });
            return res.redirect('/staff/employee/dashboard');
        }

        // Render the offboarding page
        res.render('staffpages/employee_pages/employeeoffboarding', { user });
    } catch (err) {
        console.error('Error in getEmployeeOffboarding controller:', err);
        req.flash('errors', { dbError: 'An error occurred while loading the offboarding page.' });
        res.redirect('/staff/employee/dashboard');
    }
},

 // Leave Request functionality
 getLeaveRequestForm: async function(req, res) {
    console.log('Session User:', req.session.user);
    if (req.session.user && req.session.user.userRole === 'Employee') {
        try {
            // Fetch leave types dynamically from Supabase
            const { data: leaveTypes, error } = await supabase
                .from('leave_types')
                .select('leaveTypeId, typeName'); // Adjust column name if necessary

            // Log the error if any
            if (error) {
                console.error('Error fetching leave types:', error.message); // Log the error message
                throw error; // Throw error to catch block
            }

            console.log('Fetched Leave Types:', leaveTypes);
            if (!leaveTypes || leaveTypes.length === 0) {
                req.flash('error', { fetchError: 'No leave types available.' });
                return res.redirect('/staff/login');
            }

            // Render the leave request form with the fetched leave types
            res.render('staffpages/employee_pages/employeeleaverequest', { leaveTypes });
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
submitLeaveRequest: async function (req, res) {
    // Check if the user is authenticated
    if (!req.session.user || !req.session.user.userId) {
        return res.status(401).json({ message: 'Unauthorized access' });
    }

    // Destructure the relevant fields from the request body
    const { leaveTypeId, fromDate, fromDayType, untilDate, untilDayType, reason } = req.body;

    // Ensure mandatory fields are provided
    if (!leaveTypeId || !fromDate || !fromDayType || !untilDate || !untilDayType || !reason) {
        return res.status(400).json({ message: 'All fields are required: Leave type, dates, day types, and reason.' });
    }

    try {
        // Log the incoming data for debugging
        console.log('Leave request data:', { userId: req.session.user.userId, leaveTypeId, fromDate, fromDayType, untilDate, untilDayType, reason });

        // Fetch staffId and departmentId associated with the userId
        const { data: userData, error: fetchError } = await supabase
            .from('staffaccounts')
            .select('staffId, departmentId, firstName, lastName')  // Select staffId, departmentId, firstName, and lastName
            .eq('userId', req.session.user.userId)
            .single();

        if (fetchError || !userData) {
            return res.status(404).json({ message: 'User  not found' });
        }

        const { staffId, departmentId, firstName, lastName } = userData;

        // Log or display the user's full name for confirmation
        console.log(`Leave request submitted by: ${firstName} ${lastName}`);

        // Insert the leave request into the leave_requests table
        const { error } = await supabase
            .from('leaverequests')
            .insert([
                {
                    staffId,        // Use staffId here instead of userId
                    leaveTypeId,    // Use leaveTypeId here to reference the leave type
                    fromDate,       // Start date of leave
                    fromDayType,    // Type of the starting day (e.g., half/whole day)
                    untilDate,      // End date of leave
                    untilDayType,   // Type of the end day (e.g., half/whole day)
                    reason,         // Reason for the leave request
                    status: 'Pending for Approval', // Initial status
                    departmentId    // Add departmentId to the request
                }
            ]);

        if (error) throw error;

        // If successful, respond with a success message
        res.status(200).json({ message: `Leave request submitted successfully by ${firstName} ${lastName}` });
    } catch (error) {
        // Log and respond with error in case of failure
        console.error('Error submitting leave request:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
},

};

module.exports = employeeController;
