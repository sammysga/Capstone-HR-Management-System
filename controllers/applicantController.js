const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

const applicantController = {
    getPublicHome: function(req, res) {
        res.render('publichome', { errors: {} }); 
    },
    getApplicantRegisterPage: async function(req, res) {
        res.render('applicant_pages/signup', { errors: {} });
    },

    getAboutPage: async function (req, res) {
        try {
            const { data: announcements, error } = await supabase
                .from('announcements')
                .select('announcementID, subject, imageUrl, content, createdAt');
    
            if (error) {
                console.error("Error fetching announcements:", error);
                return res.status(500).send("Error fetching announcements.");
            }
    
            res.render('applicant_pages/about', { announcements });
        } catch (error) {
            console.error("Unexpected error:", error);
            res.status(500).send("Unexpected error occurred.");
        }
    },
    

    getJobRecruitment: async function(req, res) {
        try {
            const { data: jobpositions, error } = await supabase
                .from('jobpositions')
                .select('jobId, jobTitle, jobDescrpt, isActiveJob')
                .eq('isActiveJob', true); // Filter for active jobs only
    
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
            const jobId = req.params.jobId;
    
            // Fetch job details
            const { data: job, error: jobError } = await supabase
                .from('jobpositions')
                .select('*')
                .eq('jobId', jobId)
                .single();
            
            if (jobError) {
                console.error('Error fetching job details:', jobError);
                return res.status(500).send('Error fetching job details');
            }
    
            // Fetch job skills
            const { data: jobSkills, error: jobSkillsError } = await supabase
                .from('jobreqskills') // updated to the new table name
                .select('*')
                .eq('jobId', jobId);
            
            if (jobSkillsError) {
                console.error('Error fetching job skills:', jobSkillsError);
                return res.status(500).send('Error fetching job skills');
            }
    
            // Separate hard and soft skills
            const hardSkills = jobSkills.filter(skill => skill.jobReqSkillType === "Hard");
            const softSkills = jobSkills.filter(skill => skill.jobReqSkillType === "Soft");
    
            // Fetch job certifications from jobreqcertifications
            const { data: certifications, error: certificationsError } = await supabase
                .from('jobreqcertifications')
                .select('jobReqCertificateType, jobReqCertificateDescrpt')
                .eq('jobId', jobId);
            
            if (certificationsError) {
                console.error('Error fetching job certifications:', certificationsError);
                return res.status(500).send('Error fetching job certifications');
            }
    
            // Fetch job degrees from jobreqdegrees
            const { data: degrees, error: degreesError } = await supabase
                .from('jobreqdegrees')
                .select('jobReqDegreeType, jobReqDegreeDescrpt')
                .eq('jobId', jobId);
            
            if (degreesError) {
                console.error('Error fetching job degrees:', degreesError);
                return res.status(500).send('Error fetching job degrees');
            }
    
            // Fetch job experiences from jobreqexperiences
            const { data: experiences, error: experiencesError } = await supabase
                .from('jobreqexperiences')
                .select('jobReqExperienceType, jobReqExperienceDescrpt')
                .eq('jobId', jobId);
            
            if (experiencesError) {
                console.error('Error fetching job experiences:', experiencesError);
                return res.status(500).send('Error fetching job experiences');
            }
    
            // Render the job-details page with all fetched data
            res.render('applicant_pages/job-details', { job, hardSkills, softSkills, certifications, degrees, experiences });
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

    getInternalApplicantChatbotPage: async function(req, res) {
        res.render('applicant_pages/internalapplicant_chatbot', { errors: {} }); 
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
        /* Logic is redirects both internal and external separately into the 
            2 pages: internalapplicant_chatbot (internal) and chatbot (external) 
            chatbot (external) - creation of account is need
            internalapplicant_chatbot (internal) - can sign in the same email if there is staffaccounts record
        */
        try {
            const { email, password } = req.body;
    
            console.log('Login Attempt:', { email, password });
    
            // Check if the user exists in useraccounts
            let { data: userData, error: userError } = await supabase
                .from('useraccounts')
                .select('userId, userPass, userRole')
                .eq('userEmail', email);
    
            if (userError) {
                console.error('Error querying useraccounts:', userError);
                return res.status(500).send('Internal Server Error');
            }
    
            // If user is found in useraccounts, proceed to check applicantaccounts
            if (userData.length > 0) {
                console.log('User found in useraccounts, checking applicantaccounts...');
    
                let { data: applicantData, error: applicantError } = await supabase
                    .from('applicantaccounts')
                    .select('userId')
                    .eq('userId', userData[0].userId); // Link via userId FK
    
                if (applicantError) {
                    console.error('Error querying applicantaccounts:', applicantError);
                    return res.status(500).send('Internal Server Error');
                }
    
                const passwordMatch = await bcrypt.compare(password, userData[0].userPass);
    
                if (passwordMatch) {
                    req.session.authenticated = true;
                    req.session.userID = userData[0].userId;
                    req.session.userRole = userData[0].userRole;
    
                    // If user exists in applicantaccounts, redirect to the applicant chatbot
                    if (applicantData.length > 0) {
                        console.log('Redirecting to applicant chatbot...');
                        return res.redirect('/chatbothome');
                    } else {
                        // User does not exist in applicantaccounts, so they must be an employee
                        console.log('Redirecting to employee chatbot...');
                        return res.redirect('/employeechatbothome');
                    }
                } else {
                    return res.render('applicant_pages/login', { message: 'Wrong password' });
                }
            }
    
            // If not found in useraccounts, check staffaccounts
            console.log('User not found in useraccounts, checking staffaccounts...');
    
            let { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, userPass, userRole')
                .eq('userEmail', email);
    
            if (staffError) {
                console.error('Error querying staffaccounts:', staffError);
                return res.status(500).send('Internal Server Error');
            }
    
            if (staffData.length > 0) {
                const passwordMatch = await bcrypt.compare(password, staffData[0].userPass);
    
                if (passwordMatch) {
                    req.session.authenticated = true;
                    req.session.userID = staffData[0].userId;
                    req.session.userRole = staffData[0].userRole;
    
                    console.log('Redirecting to employee chatbot...');
                    return res.redirect('/employeechatbothome'); // Redirect to employee chatbot
                } else {
                    return res.render('applicant_pages/login', { message: 'Wrong password' });
                }
            }
    
            // If no user found in either table
            res.render('applicant_pages/login', { message: 'User not found' });
    
        } catch (err) {
            console.error('Unexpected error during login process:', err);
            res.status(500).send('Internal Server Error');
        }
    },

    getOnboarding: async function(req, res) {
        res.render('applicant_pages/onboarding', { errors: {} });
    },

    getOnboardingCreateAccount: async function(req, res) {
        res.render('applicant_pages/onboarding-create-account', { errors: {} });
    },

    // commented out login submit solution only for external applicants

    // handleLoginSubmit: async function (req, res) {
    //     try {
    //         const { email, password } = req.body;

    //         console.log('Login Attempt:', { email, password });

    //         // Check user in useraccounts
    //         let { data, error } = await supabase
    //             .from('useraccounts')
    //             .select('userId, userPass, userRole')
    //             .eq('userEmail', email);

    //         console.log('useraccounts data:', data);
    //         if (error) {
    //             console.error('Error querying useraccounts:', error);
    //             return res.status(500).send('Internal Server Error');
    //         }

    //         // If user not found in useraccounts, check applicantaccounts
    //         if (data.length === 0) {
    //             console.log('User not found in useraccounts, checking applicantaccounts...');
    //             ({ data, error } = await supabase
    //                 .from('applicantaccounts')
    //                 .select('userId, userPass, userRole') 
    //                 .eq('userEmail', email));

    //             console.log('applicantaccounts data:', data);
    //             if (error) {
    //                 console.error('Error querying applicantaccounts:', error);
    //                 return res.status(500).send('Internal Server Error');
    //             }
    //         }

    //         // Check if user is found
    //         if (data.length > 0) {
    //             console.log('User found:', data[0]);

    //             // Compare the entered password with the stored hashed password
    //             const passwordMatch = await bcrypt.compare(password, data[0].userPass);
    //             console.log('Password Match:', passwordMatch);

    //             if (passwordMatch) {
    //                 // Set session variables
    //                 req.session.authenticated = true;
    //                 req.session.userID = data[0].userId;
    //                 req.session.userRole = data[0].userRole;

    //                 // Log session information
    //                 console.log('Session data:', req.session);

    //                 // Redirect to /chatbothome after successful login
    //                 return res.redirect('/chatbothome');
    //             } else {
    //                 console.log('Password mismatch');
    //             }
    //         } else {
    //             console.log('No user found');
    //         }

    //         // If no user found or password does not match
    //         res.render('applicant_pages/login', { message: 'Wrong password or email' });
    //     } catch (err) {
    //         console.error('Unexpected error during login process:', err);
    //         res.status(500).send('Internal Server Error');
    //     }
    // },
};

// Export the applicantController object
module.exports = applicantController;
