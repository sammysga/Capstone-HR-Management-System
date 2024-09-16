const supabase = require('../public/config/supabaseClient');
require('dotenv').config(); // To load environment variables
const bcrypt = require('bcrypt');

const hrController = {
    getHRDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hrdashboard');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/login/staff');
        }
    },

    getHRManageHome: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hrmanagehome');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/login/staff');
        }
    },

    getAddAnnouncement: function(req, res){
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hraddannouncement');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/login/staff');
        }
    },

    // POST code for submitting an announcement
    /*
    postAddAnnouncement: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            const { subject, image, shortAnnouncement } = req.body;
            try {
                // Form submission code insert here (save the announcement to DB)
                
                // Put alert that announcement was successfully or not added:
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/login/staff');
        }
    }
    */

    getHRManageStaff: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Fetch data from Supabase
                const { data: staffAccounts, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select('userId, departmentId, jobId, lastName, firstName');
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
    
                    return {
                        deptName: department ? department.deptName : 'Unknown',
                        jobTitle: jobPosition ? jobPosition.jobTitle : 'Unknown',
                        lastName: staff.lastName,
                        firstName: staff.firstName,
                        userEmail: userAccount ? userAccount.userEmail : 'N/A',
                        userRole: userAccount ? userAccount.userRole : 'N/A',
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
            res.redirect('/login/staff');
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

    getAddStaffForm: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Fetch departments
                const { data: departments, error: deptError } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
                if (deptError) throw deptError;

                // Fetch job positions and include the related departmentId
                const { data: jobPositions, error: jobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle, departmentId');
                if (jobError) throw jobError;

                // Organize job positions by department for easier access in the frontend
                const jobPositionsByDept = {};
                departments.forEach(dept => {
                    jobPositionsByDept[dept.departmentId] = jobPositions.filter(
                        job => job.departmentId === dept.departmentId
                    );
                });

                // Pass departments and job positions data to the form view
                res.render('staffpages/hr_pages/addstaff', { 
                    departments, 
                    jobPositionsByDept // Sending structured job positions
                });
            } catch (error) {
                console.error('Error fetching data for Add Staff form:', error);
                req.flash('errors', { fetchError: 'Failed to load form data. Please try again.' });
                res.redirect('/hr/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/login/staff');
        }
    },
    
    addNewStaff: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            const { departmentId, jobId, lastName, firstName, email, role, passwordOption, customPassword, generatedPassword } = req.body;

            try {
                // Determine password based on user selection
                const password = passwordOption === 'custom' ? customPassword : generatedPassword;

                // Hash the password
                const hashedPassword = await bcrypt.hash(password, 10);

                // Insert new user account
                const { data: userData, error: userError } = await supabase
                    .from('useraccounts')
                    .insert([{
                        userPass: hashedPassword, 
                        userRole: role,
                        userIsDisabled: false,
                        userEmail: email,
                        userStaffOgPass: password // Store the original password for reference
                    }])
                    .select()
                    .single();

                if (userError) throw userError;

                // Get the user ID
                const userId = userData.userId;

                // Insert new staff account details
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .insert([{
                        userId,
                        departmentId, // Handle departmentId from form input
                        jobId, // Handle jobId from form input
                        lastName,
                        firstName
                    }])
                    .select()
                    .single();

                if (staffError) throw staffError;

                res.status(200).json({ message: 'Staff added successfully.' });
            } catch (error) {
                console.error('Error adding staff:', error);
                res.status(500).json({ error: 'Error adding staff' });
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/login/staff');
        }
    },
};

module.exports = hrController;
