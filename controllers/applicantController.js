const supabase = require ('../public/config/supabaseClient');
const bcrypt = require ('bcrypt');

const applicantController = {

    getPublicHome: function(req, res) {
        res.render('publichome', { errors: {} }); 
    },
    getPublicSignUp: function(req, res) {
        res.render('publicsignup', { errors: {} }); 
    },

    getAboutPage: async function(req, res) {
        // Sample announcements data (replace with dynamic data if available)
        const announcements = [
            "New sustainability initiative launching next month!",
            "Annual company meeting scheduled for next week.",
            "Prime Infra wins infrastructure award for 2024."
        ];

        // Render the about page and pass the announcements data
        res.render('applicant_pages/about', { announcements });
    },

    getJobRecruitment: async function(req, res) {
        try {
          // Fetch job offers from Supabase
          const { data: joboffers, error } = await supabase
            .from('joboffers')
            .select('*')
            .order('createdAt', { ascending: false });
    
          // Handle errors in fetching data
          if (error) {
            console.error('Error fetching job offers:', error);
            return res.status(500).send('Error fetching job offers');
          }
    
          // Render the job offers on the jobrecruitment EJS page
          res.render('applicant_pages/jobrecruitment', { joboffers: joboffers, errors: {} });
    
        } catch (err) {
          console.error('Server error:', err);
          res.status(500).send('Server error');
        }
      },

      getJobDetails: async function(req, res) {
        try {
            const jobOfferId = req.params.jobOfferId; // Make sure this matches the route parameter
            const { data: job, error } = await supabase
                .from('joboffers')
                .select('*')
                .eq('jobOfferId', jobOfferId) // Use the correct column name here
                .single();
            
            if (error) {
                console.error('Error fetching job details:', error);
                return res.status(500).send('Error fetching job details');
            }
    
            // Render job details page
            res.render('applicant_pages/job-details', { job: job });
        } catch (err) {
            console.error('Server error:', err);
            res.status(500).send('Server error');
        }
    },
    
      

    
    getContactForm: async function(req, res) {
        res.render('applicant_pages/contactform', { errors: {} }); 
    },

    handleContactSubmit: async function(req, res) {
        const { inquiry, lastName, firstName, email, subject, message } = req.body;

        const errors = {};

        // Basic validation (you can enhance this as needed)
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

        // If there are validation errors, re-render the form with error messages
        if (Object.keys(errors).length > 0) {
            return res.status(400).render('applicant_pages/contactform', { errors });
        }

        // Here you would typically save the data or send an email
        // Example: Sending email logic or saving to database (not shown here)

        // On successful submission, redirect to a success page or show a message
        res.redirect('/contact-success');
    },

    getApplicantLogin: async function(req, res) {
        res.render('applicant_pages/login', { errors: {} }); 
    },

    getApplicantSignup: async function(req, res) {
        res.render('applicant_pages/signup', { errors: {} }); 
    },
    
    handleRegisterPage: async function(req, res) {
        console.log('Handling registration request...');
        const { lastName, firstName, middleInitial, birthDate, email, password, confirmPassword } = req.body;
    
        const errors = {};
    
        // Validate password on the server-side
        if (!password || password !== confirmPassword) {
            errors.password = 'Invalid password or password mismatch';
        }
    
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            errors.email = 'Invalid email format';
        }
    
        if (Object.keys(errors).length > 0) {
            return res.status(400).render('publicsignup', { errors });
        }
    
        // Check if the email already exists in the database
        const { data: existingData, error: existingDataError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userEmail', email);
    
        if (existingDataError || (existingData && existingData.length > 0)) {
            errors.email = 'Please try again, email is already existing.';
            console.error(existingDataError || 'Email is already existing.');
            return res.status(400).render('publicsignup', { errors });
        }
    
        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Hashed Password:', hashedPassword);  // Log the hashed password
    
        // Insert data into the useraccounts table
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
            console.error('Error inserting data into the useraccounts table:', userError);
            errors.general = 'Error inserting data into the database';
            return res.status(500).render('publicsignup', { errors });
        }
    
        const userId = userData.userId;
    
        // Insert data into the applicantaccounts table
        const { data: applicantData, error: applicantError } = await supabase
            .from('applicantaccounts')
            .insert([
                {
                    userId: userId,
                    lastName: lastName,
                    firstName: firstName,
                    middleInitial: middleInitial,
                    birthDate: birthDate, // Ensure this matches your database schema
                    applicantStatus: 'Account initially created',
                },
            ]);
    
        if (applicantError) {
            console.error('Error inserting data into the applicantaccounts table:', applicantError);
            errors.general = 'Error inserting applicant data into the database';
            return res.status(500).render('publicsignup', { errors });
        }
    
        // Redirect to the login page upon successful registration
        res.redirect('/login');
    },

    handleLoginSubmit: async function (req, res) {
        const { email, password } = req.body;
    
        // Query Supabase to check customer credentials
        const { data, error } = await supabase
            .from('customeraccounts')
            .select('email, password, customerId, role')
            .eq('email', email);
    
        if (error) {
            console.error(error);
            return res.status(500).send('Internal Server Error');
        }
    
        if (data.length > 0) {
    
            console.log('Supabase Data:', data);
            console.log('Supabase Error:', error);
    
            console.log('Entered Password:', password);
            console.log('Stored Hashed Password:', data[0].password);
            const passwordMatch = await bcrypt.compare(password, data[0].password);
    
            if (passwordMatch) {
                // Set session variables
                req.session.authenticated = true;
                req.session.userID = data[0].customerId;
                req.session.userRole = data[0].role;
    
                // Redirect based on user role
                switch (data[0].role) {
                    case 'employee':
                        res.redirect('/employeehome');
                        break;
                    case 'hr':
                        res.redirect('/hrhome');
                        break;
                    case 'depthead':
                        res.redirect('/deptheadhome');
                        break;
                    default:
                        // In case of an undefined role, redirect to a generic homepage or logout
                        res.redirect('/generic-home'); // Optional: handle this as per your system
                        break;
                }
            } else {
                res.render('memberlogin', { message: 'Wrong password or username' });
            }
        } else {
            res.render('memberlogin', { message: 'Wrong password or username' });
        }
    },
    


};

// Export the applicantController object
module.exports = applicantController;