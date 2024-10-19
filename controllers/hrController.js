const { render } = require('ejs');
const supabase = require('../public/config/supabaseClient');
require('dotenv').config(); // To load environment variables
const bcrypt = require('bcrypt');
const { parse } = require('dotenv');
const flash = require('connect-flash/lib/flash');
const { getUserAccount } = require('./employeeController');

const hrController = {
    getHRDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hrdashboard');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
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
                return res.redirect('/hr/dashboard');
            }

            const userData = {
                ...user,
                firstName: staff.firstName,
                lastName: staff.lastName
            };

            res.render('staffpages/hr_pages/hruseraccount', { user: userData });
        } catch (err) {
            console.error('Error in getUserAccount controller:', err);
            req.flash('errors', { dbError: 'An error occured while loading the account page.' });
            res.redirect('/hr/dashboard');
        }
    },

    updateUserInfo: async function (req, res) {
        try {
            const userId = req.session.user.userId; // Assuming userId is stored in session
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
                console.error('Error fetching job offers:', error);
                req.flash('errors', { fetchError: 'Failed to load job offers. Please try again.' });
                res.redirect('/hr/dashboard');
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
    
    postAddJobOffer: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { jobTitle, departmentId, jobDescrpt, jobBranch, jobType, jobTimeCommitment, hiringStartDate, hiringEndDate, isActiveHiring } = req.body;
            
                const { data, error } = await supabase
                    .from('jobpositions') // Using jobpositions table
                    .insert([
                        { 
                            jobTitle,
                            departmentId: parseInt(departmentId),
                            jobDescrpt,
                            jobBranch,
                            jobType,
                            jobTimeCommitment,
                            hiringStartDate,
                            hiringEndDate,
                            isActiveHiring: isActiveHiring ? true : false
                        }
                    ]);
    
                if (error) throw error;
    
                res.status(201).json({ message: 'Job offer added successfully', data });
            } catch (error) {
                console.error('Error adding job offers:', error);
                res.status(500).json({ error: 'Failed to add job offer. Please try again.' });
            }
        } else {
            res.status(403).json({ errors: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    
    getEditJobOffers: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hreditjoboffers');
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
        const { jobTitle, departmentId } = req.body;  // Assuming jobTitle and departmentId are sent in the request body
        try {
            // Insert new job title
            const { data, error } = await supabase
                .from('jobpositions')
                .insert([{ jobTitle, departmentId }]); // Add job title under specific department
            if (error) throw error;
            res.status(201).json({ message: 'New job title added', jobTitle: data });
        } catch (error) {
            console.error('Error adding job title:', error);
            res.status(500).json({ error: 'Error adding job title' });
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

    getRecordsPerformanceTracker: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Fetchh employee accounts from db
                const { data: staffAccounts, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select('staffId, userId, departmentId, jobId, lastName, firstName')
                if (staffError) throw staffError;

                const { data: departments, error: deptError } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
                if (deptError) throw deptError;

                const { data: jobPositions, error: jobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle');
                if (jobError) throw jobError;

                // Map and combine staff data
                const employeeList = await Promise.all(staffAccounts.map(async (staff) => {
                    const userAccount = userAccounts.find(user => user.userId === staff.userId);
                    const department = departments.find(dept => dept.departmentId === staff.departmentId);
                    const jobPosition = jobPositions.find(job => job.jobId === staff.jobId);

                    let jobTitle = jobPosition ? jobPosition.jobTitle : 'No job title assigned';
                    let userEmail = userAccount ? userAccount.userEmail : 'N/A';
                    let deptName = department ? department.deptName : 'Unknown';

                    return {
                        lastName: staff.lastName,
                        firstName: staff.firstName,
                        deptName,
                        jobTitle,
                        email: userEmail
                    };
                }));

                const error = req.flash('error') || {};
                res.render('staffpages/hr_pages/hrrecordsperftracker', { errors, employees: employeeList });
            } catch (error) {
                console.error('Error fetching Employee Records and Performance History data:', error);
                req.flash('errors', { fetchError: 'Failed to fetch employee records. Please try again.' });
                res.redirect('/hr/dashboard');
            }
            
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
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

module.exports = hrController;
