const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

const applicantController = {
    getPublicHome: function(req, res) {
        res.render('publichome', { errors: {} }); 
    },
    getApplicantRegisterPage: async function(req, res) {
        res.render('applicant_pages/signup', { errors: {} });
    },

    getAboutPage: async function(req, res) {
        const announcements = [
            "New sustainability initiative launching next month!",
            "Annual company meeting scheduled for next week.",
            "Prime Infra wins infrastructure award for 2024."
        ];
        res.render('applicant_pages/about', { announcements });
    },

    getJobRecruitment: async function(req, res) {
        try {
            const { data: jobpositions, error } = await supabase
                .from('jobpositions')
                .select('jobId, jobTitle, jobDescrpt, jobBranch, isActiveJob');
    
            if (error) {
                console.error('Error fetching job positions:', error);
                return res.status(500).send('Error fetching job positions');
            }
    
            res.render('applicant_pages/jobrecruitment', { jobpositions, errors: {} });
        } catch (err) {
            console.error('Server error:', err);
            res.status(500).send('Server error');
        }
    },
    

    getJobDetails: async function(req, res) {
        try {
            const jobId = req.params.jobId;  // Ensure this matches your jobId
            
            // Fetch the job details from the jobpositions table
            const { data: job, error: jobError } = await supabase
                .from('jobpositions')
                .select('*')
                .eq('jobId', jobId)
                .single();
    
            if (jobError) {
                console.error('Error fetching job details:', jobError);
                return res.status(500).send('Error fetching job details');
            }
    
            // Fetch the job requirements
            const { data: requirements, error: requirementsError } = await supabase
                .from('jobrequirements')
                .select('*')
                .eq('jobOfferId', jobId);  // Make sure the foreign key is correct
    
            if (requirementsError) {
                console.error('Error fetching job requirements:', requirementsError);
                return res.status(500).send('Error fetching job requirements');
            }
    
            // Fetch job skills from jobskills table
            const { data: jobSkills, error: jobSkillsError } = await supabase
                .from('jobskills')
                .select('*')
                .eq('jobId', jobId);
    
            if (jobSkillsError) {
                console.error('Error fetching job skills:', jobSkillsError);
                return res.status(500).send('Error fetching job skills');
            }
    
            // Separate hard and soft skills
            const hardSkills = jobSkills.filter(skill => skill.isHardSkill);
            const softSkills = jobSkills.filter(skill => !skill.isHardSkill);
    
            res.render('applicant_pages/job-details', { job, requirements, hardSkills, softSkills });
        } catch (err) {
            console.error('Server error:', err);
            res.status(500).send('Server error');
        }
    },
    
    
    

    getContactForm: async function(req, res) {
        res.render('applicant_pages/contactform', { errors: {} }); 
    },
    getChatbotPage: async function(req, res) {
        res.render('applicant_pages/chatbot', { errors: {} }); 
    },

    handleContactSubmit: async function(req, res) {
        const { inquiry, lastName, firstName, email, subject, message } = req.body;
        const errors = {};

        // Basic validation
        if (!inquiry) errors.inquiry = 'Inquiry type is required';
        if (!lastName) errors.lastName = 'Last name is required';
        if (!firstName) errors.firstName = 'First name is required';
        if (!email) {
            errors.email = 'Email address is required';
        } else {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                errors.email = 'Invalid email format';
            }
        }
        if (!subject) errors.subject = 'Subject is required';
        if (!message) errors.message = 'Message is required';

        if (Object.keys(errors).length > 0) {
            return res.status(400).render('applicant_pages/contactform', { errors });
        }

        // Logic for sending an email or saving the inquiry can go here

        res.redirect('/contact-success');
    },

    getApplicantLogin: async function(req, res) {
        res.render('applicant_pages/login', { errors: {} }); 
    },

    handleRegisterPage: async function(req, res) {
        console.log('Handling registration request...');
        const { lastName, firstName, middleInitial, birthDate, email, password, confirmPassword } = req.body;
        const errors = {};

        // Password validation
        if (!password || !confirmPassword || password !== confirmPassword) {
            errors.password = 'Password is required and must match the confirmation';
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            errors.email = 'Invalid email format';
        }

        if (Object.keys(errors).length > 0) {
            return res.status(400).render('applicant_pages/signup', { errors });
        }

        // Check if email already exists
        const { data: existingData, error: existingDataError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userEmail', email);

        if (existingDataError) {
            console.error('Database error:', existingDataError);
            errors.general = 'Error checking existing email';
            return res.status(500).render('applicant_pages/signup', { errors });
        }

        if (existingData && existingData.length > 0) {
            errors.email = 'Email is already in use';
            return res.status(400).render('applicant_pages/signup', { errors });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user data
        const { data: userData, error: userError } = await supabase
            .from('useraccounts')
            .insert([
                {
                    userEmail: email,
                    userPass: hashedPassword,
                    userRole: 'Applicant',
                    userIsDisabled: false,
                },
            ])
            .select('userId')
            .single();

        if (userError) {
            console.error('Error inserting data into useraccounts:', userError);
            errors.general = 'Error inserting data into the database';
            return res.status(500).render('applicant_pages/signup', { errors });
        }

        // Insert applicant data
        const { data: applicantData, error: applicantError } = await supabase
            .from('applicantaccounts')
            .insert([
                {
                    userId: userData.userId,
                    lastName: lastName,
                    firstName: firstName,
                    middleInitial: middleInitial,
                    birthDate: birthDate,
                    applicantStatus: 'Account initially created',
                },
            ]);

        if (applicantError) {
            console.error('Error inserting data into applicantaccounts:', applicantError);
            errors.general = 'Error inserting applicant data into the database';
            return res.status(500).render('applicant_pages/signup', { errors });
        }

        // Redirect upon success
        res.redirect('/applicant/login');
    },

    handleLoginSubmit: async function (req, res) {
        try {
            const { email, password } = req.body;

            console.log('Login Attempt:', { email, password });

            // Check user in useraccounts
            let { data, error } = await supabase
                .from('useraccounts')
                .select('userId, userPass, userRole')
                .eq('userEmail', email);

            console.log('useraccounts data:', data);
            if (error) {
                console.error('Error querying useraccounts:', error);
                return res.status(500).send('Internal Server Error');
            }

            // If user not found in useraccounts, check applicantaccounts
            if (data.length === 0) {
                console.log('User not found in useraccounts, checking applicantaccounts...');
                ({ data, error } = await supabase
                    .from('applicantaccounts')
                    .select('userId, userPass, userRole') 
                    .eq('userEmail', email));

                console.log('applicantaccounts data:', data);
                if (error) {
                    console.error('Error querying applicantaccounts:', error);
                    return res.status(500).send('Internal Server Error');
                }
            }

            // Check if user is found
            if (data.length > 0) {
                console.log('User found:', data[0]);

                // Compare the entered password with the stored hashed password
                const passwordMatch = await bcrypt.compare(password, data[0].userPass);
                console.log('Password Match:', passwordMatch);

                if (passwordMatch) {
                    // Set session variables
                    req.session.authenticated = true;
                    req.session.userID = data[0].userId;
                    req.session.userRole = data[0].userRole;

                    // Log session information
                    console.log('Session data:', req.session);

                    // Redirect to /chatbothome after successful login
                    return res.redirect('/chatbothome');
                } else {
                    console.log('Password mismatch');
                }
            } else {
                console.log('No user found');
            }

            // If no user found or password does not match
            res.render('applicant_pages/login', { message: 'Wrong password or email' });
        } catch (err) {
            console.error('Unexpected error during login process:', err);
            res.status(500).send('Internal Server Error');
        }
    },
};

// Export the applicantController object
module.exports = applicantController;
