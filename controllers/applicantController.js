const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const path = require('path');  // Add this line
const fs = require('fs');  // Add this line



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

// Fixed version of getJobDetails method with better error handling
getJobDetailsTitle: async function(req, res) {
    try {
        const jobId = req.params.jobId;
        
        if (!jobId) {
            console.error('No job ID provided');
            return res.status(400).send('Job ID is required');
        }

        console.log(`Fetching job details for jobId: ${jobId}`);

        // Fetch job details
        let { data: job, error: jobError } = await supabase
            .from('jobpositions')
            .select('*')
            .eq('jobId', jobId);
        
        if (jobError) {
            console.error('Error fetching job details:', jobError);
            return res.status(500).send('Error fetching job details');
        }

        // Check if any job was found
        if (!job || job.length === 0) {
            console.error('Job not found for ID:', jobId);
            return res.status(404).send('Job not found');
        }

        // Since we're not using .single(), we need to take the first result
        job = job[0];
        console.log('Job data retrieved:', job);

        // Fetch job skills
        const { data: jobSkills, error: jobSkillsError } = await supabase
            .from('jobreqskills')
            .select('*')
            .eq('jobId', jobId);
        
        if (jobSkillsError) {
            console.error('Error fetching job skills:', jobSkillsError);
            return res.status(500).send('Error fetching job skills');
        }

        // Separate hard and soft skills
        const hardSkills = jobSkills.filter(skill => skill.jobReqSkillType === "Hard");
        const softSkills = jobSkills.filter(skill => skill.jobReqSkillType === "Soft");

        console.log(`Found ${hardSkills.length} hard skills and ${softSkills.length} soft skills`);

        // Fetch job certifications
        const { data: certifications, error: certificationsError } = await supabase
            .from('jobreqcertifications')
            .select('jobReqCertificateType, jobReqCertificateDescrpt')
            .eq('jobId', jobId);
        
        if (certificationsError) {
            console.error('Error fetching job certifications:', certificationsError);
            return res.status(500).send('Error fetching job certifications');
        }

        // Fetch job degrees
        const { data: degrees, error: degreesError } = await supabase
            .from('jobreqdegrees')
            .select('jobReqDegreeType, jobReqDegreeDescrpt')
            .eq('jobId', jobId);
        
        if (degreesError) {
            console.error('Error fetching job degrees:', degreesError);
            return res.status(500).send('Error fetching job degrees');
        }

        // Fetch job experiences
        const { data: experiences, error: experiencesError } = await supabase
            .from('jobreqexperiences')
            .select('jobReqExperienceType, jobReqExperienceDescrpt')
            .eq('jobId', jobId);
        
        if (experiencesError) {
            console.error('Error fetching job experiences:', experiencesError);
            return res.status(500).send('Error fetching job experiences');
        }

        // Standardize property names to match the template
        // This handles potential mismatches between database fields and what the template expects
        if (job.isActiveHiring !== undefined && job.isActiveJob === undefined) {
            job.isActiveJob = job.isActiveHiring;
        } else if (job.isActiveJob === undefined) {
            job.isActiveJob = false; // Default value
        }

        // Log the data being sent to the template (for debugging)
        console.log('Rendering job details with data for job:', job.jobTitle);

        // Render the job-details page with all fetched data
        res.render('applicant_pages/job-details', { 
            job, 
            hardSkills, 
            softSkills, 
            certifications, 
            degrees, 
            experiences 
        });
    } catch (err) {
        console.error('Server error in getJobDetails:', err);
        res.status(500).send('Server error occurred while retrieving job details');
    }
},
    
    // Fixed version of the getJobDetails method that takes a jobTitle parameter
    getActiveJobPositionsList: async function() {
        try {
            const today = new Date().toISOString().split('T')[0]; // Get today's date in "YYYY-MM-DD" format
            console.log('Today:', today);
            
            // Only filter by end date, not start date
            const { data: jobpositions, error } = await supabase
                .from('jobpositions')
                .select('jobId, jobTitle, hiringStartDate, hiringEndDate')
                .gte('hiringEndDate', today); // Only keep jobs that haven't ended yet
            
            if (error) {
                console.error('❌ [Database] Error fetching job positions:', error.message);
                return []; // Return an empty array on error
            }
    
            console.log('✅ [Database] Fetched job positions:', jobpositions);
    
            if (!jobpositions || !Array.isArray(jobpositions)) {
                console.error('❌ [Database] Job positions data is invalid:', jobpositions);
                return [];
            }
    
            return jobpositions.map(position => ({
                jobId: position.jobId,
                jobTitle: position.jobTitle
            }));
            
        } catch (error) {
            console.error('❌ [Server] Unexpected error:', error);
            return [];
        }
    },

    getJobDetailsbyTitle: async function(jobTitle) {
        try {
            const { data: jobDetails, error } = await supabase
                .from('jobpositions')
                .select(`
                    jobId, jobTitle, jobDescrpt,  departmentId,
                    jobreqcertifications(jobReqCertificateType, jobReqCertificateDescrpt),
                    jobreqdegrees(jobReqDegreeType, jobReqDegreeDescrpt),
                    jobreqexperiences(jobReqExperienceType, jobReqExperienceDescrpt),
                    jobreqskills(jobReqSkillType, jobReqSkillName)
                `)
                .eq('jobTitle', jobTitle)
                .single();
    
            if (error) {
                console.error('Error fetching job details:', error);
                return null;
            }
            
            // Ensure all arrays exist even if they're empty
            return {
                ...jobDetails,
                jobreqcertifications: jobDetails.jobreqcertifications || [],
                jobreqdegrees: jobDetails.jobreqdegrees || [],
                jobreqexperiences: jobDetails.jobreqexperiences || [],
                jobreqskills: jobDetails.jobreqskills || []
            };
        } catch (error) {
            console.error('Server error:', error);
            return null;
        }
    },


    getJobDetails: async function(jobTitle) {
        try {
           const today = new Date().toISOString().split('T')[0]; // Get today's date in "YYYY-MM-DD" format
        
        console.log('Today:', today);
        console.log('Query parameters:', {
            hiringEndDate: today,
            hiringStartDate: today
        });
        
        const { data: jobpositions, error } = await supabase
            .from('jobpositions')
            .select('jobId, jobTitle, hiringStartDate, hiringEndDate')
            .gte('hiringEndDate', today) // hiringEndDate should be today or later
            .lte('hiringStartDate', today); // hiringStartDate should be today or earlier
    
            if (error) {
                console.error('Error fetching job details:', error);
                return null;
            }
            
            // Ensure all arrays exist even if they're empty
            return {
                ...jobDetails,
                jobreqcertifications: jobDetails.jobreqcertifications || [],
                jobreqdegrees: jobDetails.jobreqdegrees || [],
                jobreqexperiences: jobDetails.jobreqexperiences || [],
                jobreqskills: jobDetails.jobreqskills || []
            };
        } catch (error) {
            console.error('Server error:', error);
            return null;
        }
    },
    // Function to fetch job positions and format them for chatbot response
    getJobPositionsList: async function() {
        try {
            const { data: jobpositions, error } = await supabase
                .from('jobpositions')
                .select('jobId, jobTitle');
    
            if (error) {
                console.error('Error fetching job positions:', error);
                return []; // Return an empty array on error
            }
    
            return jobpositions.map(position => position.jobTitle);
        } catch (error) {
            console.error('Server error:', error);
            return [];
        }
    },
    
    getContactForm: async function(req, res) {
        res.render('applicant_pages/contactform', { errors: {} }); 
    },
    // getChatbotPage: async function(req, res) {
    //     res.render('applicant_pages/chatbot', { errors: {} }); 
    // },

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
        const { lastName, firstName, middleInitial, birthDate, phoneNo, email, password, confirmPassword } = req.body;
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
        
        // Phone number validation
        const phoneRegex = /^\d{10,11}$/;
        if (!phoneNo || !phoneRegex.test(phoneNo)) {
            errors.phoneNo = 'Valid phone number is required (10-11 digits)';
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
                    phoneNo: phoneNo,
                    applicantStatus: null,
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
    
            // Check if the user exists in useraccounts
            let { data: userData, error: userError } = await supabase
                .from('useraccounts')
                .select('userId, userPass, userRole')
                .eq('userEmail', email);
    
            if (userError) {
                console.error('Error querying useraccounts:', userError);
                return res.status(500).send('Internal Server Error');
            }
    
            console.log('User  Data:', userData);
    
            if (userData.length > 0) {
                console.log('User  found in useraccounts, checking applicantaccounts...');
    
                let { data: applicantData, error: applicantError } = await supabase
                    .from('applicantaccounts')
                    .select('userId')
                    .eq('userId', userData[0].userId); // Link via userId FK
    
                if (applicantError) {
                    console.error('Error querying applicantaccounts:', applicantError);
                    return res.status(500).send('Internal Server Error');
                }
    
                console.log('Applicant Data:', applicantData);
    
                const passwordMatch = await bcrypt.compare(password, userData[0].userPass);
    
                if (passwordMatch) {
                    req.session.authenticated = true;
                    req.session.userID = userData[0].userId;
                    req.session.userRole = userData[0].userRole;
    
                    // Fetch existing screening data for the user
                    let { data: screeningData, error: screeningError } = await supabase
                        .from('applicant_initialscreening_assessment')
                        .select('*')
                        .eq('userId', userData[0].userId)
                        .single();
    
                    if (screeningError) {
                        console.error('Error fetching screening data:', screeningError);
                    }
    
                    // Store screening data in session if it exists
                    if (screeningData) {
                        req.session.screeningCounters = {
                            degree: screeningData.degreeScore,
                            experience: screeningData.experienceScore,
                            certification: screeningData.certificationScore,
                            hardSkill: screeningData.hardSkillsScore,
                            softSkill: screeningData.softSkillsScore,
                            work_setup: screeningData.workSetupScore ? 1 : 0,
                            availability: screeningData.availabilityScore ? 1 : 0
                        };
                        req.session.currentQuestionIndex = screeningData.currentQuestionIndex || 0; // Store the last answered question index
                        req.session.selectedPosition = screeningData.jobId; // Store the job ID
                        req.session.applicantStage = 'screening_questions'; // Set the stage to continue
                    } else {
                        // Initialize session variables if no screening data exists
                        req.session.screeningCounters = {
                            degree: 0, // Add this entry
                            experience: 0,
                            certification: 0,
                            hardSkill: 0,
                            softSkill: 0,
                            work_setup: 0,
                            availability: 0
                        };
                        req.session.currentQuestionIndex = 0; // Start from the beginning
                        req.session.applicantStage = 'initial'; // Set the stage to initial
                    }
    
                    // Fetch chatbot history for the user
                    let { data: chatHistory, error: chatHistoryError } = await supabase
                        .from('chatbot_history')
                        .select('*')
                        .eq('userId', userData[0].userId)
                        .order('timestamp', { ascending: true });
    
                    if (chatHistoryError) {
                        console.error('Error fetching chatbot history:', chatHistoryError);
                        return res.status(500).send('Internal Server Error');
                    }
    
                    console.log('Chat History:', chatHistory);
    
                    // Store chatbot history in session or pass it to frontend
                    req.session.chatHistory = chatHistory || [];
    
                    if (applicantData.length > 0) {
                        console.log('Redirecting to applicant chatbot...');
                        return res.redirect('/chatbothome');
                    } else {
                        console.log('Redirecting to employee chatbot...');
                        return res.redirect('/chatbothome'); // Redirect to employee chatbot
                    }
                } else {
                    console.log('Password mismatch for user:', email);
                    return res.render('applicant_pages/login', { message: 'Wrong password' });
                }
            }
    
            console.log('User  not found in both useraccounts and staffaccounts.');
            return res.render('applicant_pages/login', { message: 'User  not found' });
    
        } catch (error) {
            console.error('Error during login:', error);
            return res.status(500).send('Internal Server Error');
        }
    },

    // Add this method to your applicantController
updateApplicantStatus: async function(req, res) {
    try {
        const { userId, status } = req.body;
        
        if (!userId || !status) {
            return res.status(400).json({ 
                success: false, 
                error: "Missing userId or status" 
            });
        }
        
        // Validate session for security
        if (!req.session.authenticated || req.session.userID != userId) {
            return res.status(401).json({
                success: false,
                error: "Unauthorized"
            });
        }
        
        console.log(`✅ [API] Updating applicant status for userId ${userId} to ${status}`);
        
        // Update the database
        const { data, error } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: status })
            .eq('userId', userId);
            
        if (error) {
            console.error('❌ [API] Error updating applicant status:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
        
        // Update session if needed
        req.session.applicantStage = status;
        
        console.log(`✅ [API] Successfully updated status to ${status}`);
        return res.status(200).json({
            success: true,
            message: `Applicant status updated to ${status}`
        });
        
    } catch (error) {
        console.error('❌ [API] Unexpected error updating status:', error);
        return res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
},
   

    getChatbotPage: async function(req, res) {
        try {
            const userId = req.session.userID;
            console.log('✅ [getChatbotPage] User ID from session:', userId);
    
            // ✅ Check if user is authenticated
            if (!userId) {
                console.log('❌ [getChatbotPage] User not authenticated. Redirecting to login...');
                return res.redirect('/applicant/login');
            }
    
            // ✅ Check if there's already chat history in the session
            let chatData = req.session.chatHistory || [];
            let initialResponse = {};
    
            // ✅ Always define an initialResponse (even if empty)
            const initialMessage = "Hi! Welcome to Prime Infrastructure Recruitment Screening Portal. What position are you going to apply for?";
    
            // ✅ If no chat history in session, fetch it from Supabase
            if (chatData.length === 0) {
                console.log('✅ [getChatbotPage] No chat history in session. Fetching from database...');
    
                const { data: chatHistory, error } = await supabase
                    .from('chatbot_history')
                    .select('message, sender, timestamp')
                    .eq('userId', userId)
                    .order('timestamp', { ascending: true });
    
                if (error) {
                    console.error('❌ [getChatbotPage] Error fetching chat history from database:', error);
                }
    
                if (chatHistory && chatHistory.length > 0) {
                    console.log('✅ [getChatbotPage] Chat history found in database. Mapping it now...');
    
                    // ✅ Map the fetched data to session format
                    chatData = chatHistory.map(chat => ({
                        message: chat.message,
                        sender: chat.sender,
                        timestamp: chat.timestamp
                    }));
    
                    // ✅ Store it in the session for faster loading next time
                    req.session.chatHistory = chatData;
                    console.log('✅ [getChatbotPage] Chat history stored in session.');
                } else {
                    console.log('✅ [getChatbotPage] No chat history in database. Preparing initial message.');
    
                    try {
                        // ✅ Fetch job positions from your controller
                        const positions = await applicantController.getActiveJobPositionsList();
                        console.log('✅ [getChatbotPage] Job positions fetched successfully:', positions);
    
                        // ✅ Prepare the initial response
                        initialResponse = {
                            text: `${initialMessage}\nHere are our current job openings:`,
                            buttons: positions.map(pos => ({
                                text: pos.jobTitle,
                                value: pos.jobTitle
                            }))
                        };
    
                        // ✅ Push the initial message to chat history
                        chatData.push({
                            message: JSON.stringify(initialResponse),
                            sender: 'bot',
                            timestamp: new Date().toISOString()
                        });
    
                        // ✅ Save it in session
                        req.session.chatHistory = chatData;
                    } catch (jobError) {
                        console.error("❌ [getChatbotPage] Error fetching job positions:", jobError);
                        initialResponse = { text: initialMessage, buttons: [] };
                    }
                }
            }
    
            // ✅ Render the chatbot page with chatData
          // Render the chatbot page with chatData
res.render('applicant_pages/chatbot', {
    initialResponse,
    chatData: JSON.stringify(chatData) // Pass as a JSON string
});
    
        } catch (error) {
            console.error('❌ [getChatbotPage] Error rendering chatbot page:', error);
            res.status(500).send('Error loading chatbot page');
        }
    },
    
    handleChatbotMessage: async function (req, res) {
        try {
            console.log('✅ [Chatbot] Start processing chatbot message');
            const today = new Date().toISOString().split('T')[0]; // Get today's date in "YYYY-MM-DD" format

    
            const userId = req.session.userID;
            if (!userId) {
                return res.status(401).json({ response: "Unauthorized" });
            }

            // Check if this is a predefined message (like the thank you after Calendly)
            if (req.body.predefinedMessage) {
                console.log('✅ [Chatbot] Processing predefined message:', req.body.predefinedMessage);
                
                const predefinedMessage = req.body.predefinedMessage;
                const timestamp = new Date().toISOString();
                
                // Save the predefined message to chat history
                await supabase
                    .from('chatbot_history')
                    .insert([{ 
                        userId, 
                        message: JSON.stringify(predefinedMessage),
                        sender: 'bot', 
                        timestamp,
                        applicantStage: predefinedMessage.applicantStage || req.session.applicantStage 
                    }]);
                
                // If the applicant stage was specified, update it in the session and database
                if (predefinedMessage.applicantStage) {
                    req.session.applicantStage = predefinedMessage.applicantStage;
                    
                    // Update the applicant status in the database
                    console.log(`✅ [Chatbot] Updating applicant status to ${predefinedMessage.applicantStage}`);
                    const { error: updateError } = await supabase
                        .from('applicantaccounts')
                        .update({ applicantStatus: predefinedMessage.applicantStage })
                        .eq('userId', userId);
                        
                    if (updateError) {
                        console.error(`❌ [Chatbot] Error updating applicant status to ${predefinedMessage.applicantStage}:`, updateError);
                    } else {
                        console.log(`✅ [Chatbot] Applicant status successfully updated to ${predefinedMessage.applicantStage}`);
                    }
                }
                
                // Return success response
                return res.status(200).json({ success: true });
            }
    
            const userMessage = req.body.message.toLowerCase();
            const timestamp = new Date().toISOString();
            console.log(`✅ [Chatbot] UserID: ${userId}, Message: ${userMessage}, Timestamp: ${timestamp}`);

            // Save user message
        await supabase
        .from('chatbot_history')
        .insert([{ userId, message: userMessage, sender: 'user', timestamp, applicantStage: req.session.applicantStage }]);
    
            // Fetch chat history
            const { data: chatHistory, error: chatHistoryError } = await supabase
                .from('chatbot_history')
                .select('*')
                .eq('userId', userId)
                .order('timestamp', { ascending: true });
    
            if (chatHistoryError) {
                console.error('❌ [Chatbot] Error fetching chat history:', chatHistoryError);
                return res.status(500).json({ response: "Error fetching chat history." });
            }
    
            // Save user message
            await supabase
                .from('chatbot_history')
                .insert([{ userId, message: userMessage, sender: 'user', timestamp, applicantStage: req.session.applicantStage }]);
    
                console.log('📂 [Chatbot] Checking applicant status...');
// Check if applicant status has been updated to "P1 - PASSED"
const { data: applicantData, error: applicantError } = await supabase
    .from('applicantaccounts')
    .select('applicantStatus')
    .eq('userId', userId)
    .single();

    if (!applicantError && applicantData && applicantData.applicantStatus === 'P2 - Awaiting for HR Evaluation') {
        console.log('✅ [Chatbot] User has scheduled an interview');
        // You could add special handling here if needed
    }

if (applicantError) {
    console.error('❌ [Chatbot] Error fetching applicant status:', applicantError);
} else if (applicantData) {
    console.log(`✅ [Chatbot] Applicant status is: ${applicantData.applicantStatus}`);
    
    // Handle P1 - PASSED status
if (applicantData.applicantStatus === 'P1 - PASSED') {
    console.log('✅ [Chatbot] Applicant status is P1 - PASSED. Sending congratulations message.');
    
    const congratsMessage = "Congratulations! We are delighted to inform you that you have successfully passed the initial screening process. We look forward to proceeding with the next interview stage via Calendly.";
    
    // Add a follow-up message with Calendly link
    const calendlyMessage = "Please click the button below to schedule your interview at your convenience:";
    
    // Save congratulations message to chat history
    await supabase
        .from('chatbot_history')
        .insert([{
            userId,
            message: JSON.stringify({ text: congratsMessage }),
            sender: 'bot',
            timestamp: new Date().toISOString(),
            applicantStage: 'P1 - PASSED'
        }]);
        
    // Save Calendly link message to chat history with slight delay
    await supabase
        .from('chatbot_history')
        .insert([{
            userId,
            message: JSON.stringify({ 
                text: calendlyMessage,
                buttons: [
                    { 
                        text: "Schedule Interview", 
                        value: "schedule_interview",
                        url: "/applicant/schedule-interview"
                    }
                ]
            }),
            sender: 'bot',
            timestamp: new Date(Date.now() + 1000).toISOString(), // 1 second delay
            applicantStage: 'P1 - PASSED'
        }]);
        
    req.session.applicantStage = 'P1 - PASSED';
    
    // Return both messages for immediate display
    return res.status(200).json({ 
        response: { 
            text: congratsMessage,
            nextMessage: {
                text: calendlyMessage,
                buttons: [
                    { 
                        text: "Schedule Interview", 
                        value: "schedule_interview",
                        url: "/applicant/schedule-interview"
                    }
                ]
            }
        } 
    });
}

// Inside the code that handles P2 - PASSED status in handleChatbotMessage
else if (applicantData.applicantStatus === 'P2 - PASSED') {
    console.log('✅ [Chatbot] Applicant status is P2 - PASSED. Sending second interview message.');
    
    const congratsMessage = "Congratulations! We are pleased to inform you that you have successfully passed the initial interview. We would like to invite you for a final interview with our senior management team.";
    
    // Add a follow-up message with Calendly link for the second interview
    const calendlyMessage = "Please click the button below to schedule your final interview at your convenience:";
    
    // Save congratulations message to chat history
    await supabase
        .from('chatbot_history')
        .insert([{
            userId,
            message: JSON.stringify({ text: congratsMessage }),
            sender: 'bot',
            timestamp: new Date().toISOString(),
            applicantStage: 'P2 - PASSED'
        }]);
        
    // Save Calendly link message to chat history with slight delay
    await supabase
        .from('chatbot_history')
        .insert([{
            userId,
            message: JSON.stringify({ 
                text: calendlyMessage,
                buttons: [
                    { 
                        text: "Schedule Final Interview", 
                        value: "schedule_final_interview",
                        url: "/applicant/schedule-interview?stage=P2" // Make sure to include stage=P2 parameter
                    }
                ]
            }),
            sender: 'bot',
            timestamp: new Date(Date.now() + 1000).toISOString(), // 1 second delay
            applicantStage: 'P2 - PASSED'
        }]);
        
    req.session.applicantStage = 'P2 - PASSED';
    
    // Return both messages for immediate display
    return res.status(200).json({ 
        response: { 
            text: congratsMessage,
            nextMessage: {
                text: calendlyMessage,
                buttons: [
                    { 
                        text: "Schedule Final Interview", 
                        value: "schedule_final_interview",
                        url: "/applicant/schedule-interview?stage=P2" // Make sure to include stage=P2 parameter
                    }
                ]
            }
        } 
    });
}
    
// Handle P1 - FAILED status
else if (applicantData.applicantStatus === 'P1 - FAILED') {
    console.log('❌ [Chatbot] Applicant status is P1 - FAILED. Sending rejection message.');
    
    const rejectionMessage = "We regret to inform you that you have not been chosen as a candidate for this position. Thank you for your interest in applying at Prime Infrastructure, and we wish you the best in your future endeavors.";
    
    // Save rejection message to chat history
    await supabase
        .from('chatbot_history')
        .insert([{
            userId,
            message: JSON.stringify({ text: rejectionMessage }),
            sender: 'bot',
            timestamp: new Date().toISOString(),
            applicantStage: 'P1 - FAILED'
        }]);
        
    req.session.applicantStage = 'P1 - FAILED';
    
    return res.status(200).json({ response: { text: rejectionMessage } });
}

}
else {
    console.log(`✅ [Chatbot] Applicant status is: ${applicantData.applicantStatus}`);
}

// Continue with the rest of your logic...
    
            let botResponse;
            let applicantStage = req.session.applicantStage || 'initial';
            console.log(`Initial Applicant Stage: ${applicantStage}`);
    
            // Fetch job positions
            const positions = await applicantController.getActiveJobPositionsList();
            console.log('Today:', today);
            console.log('Query parameters:', {
                hiringEndDateGte: today,
                hiringStartDateLte: today
            });
            const selectedPosition = positions.find(position => userMessage.includes(position.jobTitle.toLowerCase()))?.jobTitle;
    
            req.session.screeningCounters = req.session.screeningCounters || {
                degree: 0, experience: 0, certification: 0,
                hardSkill: 0, softSkill: 0, work_setup: 0, availability: 0
            };
    
            if (selectedPosition) {
                req.session.selectedPosition = selectedPosition;
                const jobDetails = await applicantController.getJobDetailsbyTitle(selectedPosition);
    
                if (jobDetails) {
                    // Update applicantaccounts with jobId and departmentId
                    const updateJobResult = await applicantController.updateApplicantJobAndDepartmentOnATS(
                        userId,
                        jobDetails.jobId,
                        jobDetails.departmentId  // departmentId fetched from jobDetails
                    );
                    if (!updateJobResult.success) {
                        console.error(updateJobResult.message);
                        botResponse = "Error updating your application details. Please try again later.";
                        res.status(500).json({ response: botResponse });
                        return;
                    }
    
                    const degrees = jobDetails.jobreqdegrees && jobDetails.jobreqdegrees.length > 0
                        ? jobDetails.jobreqdegrees.map(degree => `${degree.jobReqDegreeType}: ${degree.jobReqDegreeDescrpt}`).join(', ')
                        : 'None';   
                    const certifications = jobDetails.jobreqcertifications
                        ? jobDetails.jobreqcertifications.map(cert => `${cert.jobReqCertificateType}: ${cert.jobReqCertificateDescrpt}`).join(', ')
                        : 'None';                 
                    const experiences = jobDetails.jobreqexperiences
                        ? jobDetails.jobreqexperiences.map(exp => `${exp.jobReqExperienceType}: ${exp.jobReqExperienceDescrpt}`).join(', ')
                        : 'None';
                    const hardSkills = jobDetails.jobreqskills
                        ? jobDetails.jobreqskills.filter(skill => skill.jobReqSkillType === 'Hard').map(skill => skill.jobReqSkillName).join(', ')
                        : 'None';
                    const softSkills = jobDetails.jobreqskills
                        ? jobDetails.jobreqskills.filter(skill => skill.jobReqSkillType === 'Soft').map(skill => skill.jobReqSkillName).join(', ')
                        : 'None';
    
                    // Proceed to screening questions
                    botResponse = {
                        text: `You have chosen *${selectedPosition}*. Here are the details:\n` +
                            `**Job Title:** ${jobDetails.jobTitle}\n` +
                            `**Description:** ${jobDetails.jobDescrpt}\n\n` +
                            `Would you like to proceed with your application?`,
                        buttons: [
                            { text: 'Yes', value: 'yes' },
                            { text: 'No', value: 'no' }
                        ]
                    };
                    req.session.applicantStage = 'job_selection';
                } else {
                    botResponse = "Sorry, I couldn't find the job details.";
                }
            }
            else if (applicantStage === 'job_selection' && userMessage.includes('yes')) {
                const jobDetails = await applicantController.getJobDetailsbyTitle(req.session.selectedPosition);
                if (!jobDetails || isNaN(jobDetails.jobId)) {
                    console.error('❌ [Chatbot] Invalid jobId:', jobDetails.jobId);
                    return res.status(500).json({ response: 'Error identifying job details. Please try again later.' });
                }
    
                const jobId = jobDetails.jobId;
                const result = await applicantController.updateApplicantStatusToP1Initial(userId);
    
                if (!result.success) {
                    console.error('❌ [Chatbot] Failed to update applicant status:', result.message);
                    return res.status(500).json({ response: result.message });
                }
    
                // ✅ Retrieve Screening Questions
                if (!req.session.screeningQuestions) {
                    const questions = await applicantController.getInitialScreeningQuestions(jobId);
                    if (!questions || questions.length === 0) {
                        botResponse = "No screening questions available for this position.";
                        return res.status(200).json({ response: botResponse });
                    }
    
                    req.session.screeningQuestions = questions;
                    req.session.currentQuestionIndex = 0;
                    req.session.screeningScores = [];
                }
    
                // ✅ Ask the first question
                const questions = req.session.screeningQuestions;
                const currentIndex = req.session.currentQuestionIndex;
                botResponse = {
                    text: questions[currentIndex].text,
                    buttons: [
                        { text: 'Yes', value: 1 },
                        { text: 'No', value: 0 }
                    ]
                };
                req.session.applicantStage = 'screening_questions';
    
            // ✅ Process Answered Questions
            } else if (applicantStage === 'screening_questions') {
                const questions = req.session.screeningQuestions;
                const currentIndex = req.session.currentQuestionIndex;
            
                if (currentIndex < questions.length) {
                    const currentQuestion = questions[currentIndex];
                    const answerValue = userMessage.includes('yes') ? 1 : 0;
            
                    // Track the type of question being answered
                    const questionType = currentQuestion.type;
            
                    // After storing the question and answer
                    req.session.screeningScores.push({
                        question: currentQuestion.text,
                        answer: answerValue,
                        type: questionType
                    });
            
                    // Update the database with the current scores
                    await applicantController.saveScreeningScores(
                        userId, req.session.selectedPosition, req.session.screeningScores, req.session.resumeUrl
                    );
                    
                    // Update the appropriate counter
                    if (req.session.screeningCounters && questionType) {
                        req.session.screeningCounters[questionType] = 
                            (req.session.screeningCounters[questionType] || 0) + answerValue;
                    }
                    
                    // File upload request for degree and certification "Yes" answers
                    if (questionType === 'degree' && answerValue === 1) {
                        req.session.awaitingFileUpload = 'degree';
                        botResponse = {
                            text: "Please upload your degree certificate.",
                            buttons: [{ text: 'Upload Degree File', type: 'file_upload' }]
                        };
                        
                        // We don't increment the question index here, as it should be incremented 
                        // after the file upload is complete
                        return res.status(200).json({ response: botResponse });
                    }
            
                    if (questionType === 'certification' && answerValue === 1) {
                        req.session.awaitingFileUpload = 'certification';
                        botResponse = {
                            text: "Please upload your certification document.",
                            buttons: [{ text: 'Upload Certification File', type: 'file_upload' }]
                        };
                        
                        // We don't increment the question index here, as it should be incremented 
                        // after the file upload is complete
                        return res.status(200).json({ response: botResponse });
                    }
            
                    // Automatic rejection for work setup or availability
                    if ((questionType === 'work_setup' || questionType === 'availability') && answerValue === 0) {
                        console.log(`❌ [Chatbot] Automatic rejection triggered: ${questionType} = No`);
                        
                        // Save remaining questions as "No" answers
                        for (let i = currentIndex + 1; i < questions.length; i++) {
                            req.session.screeningScores.push({
                                question: questions[i].text,
                                answer: 0,
                                type: questions[i].type
                            });
                        }
            
                        // Save scores
                        const saveResult = await applicantController.saveScreeningScores(
                            userId, req.session.selectedPosition, req.session.screeningScores, req.session.resumeUrl
                        );
            
                        // Rejection message
                        botResponse = {
                            text: "We regret to inform you that you have not met the requirements for this position. Thank you for your interest in applying at Prime Infrastructure, and we wish you the best in your future endeavors."
                        };
                        
                        req.session.applicantStage = 'rejected';
                    } else {
                        // For questions that don't require file upload, move to the next question
                        req.session.currentQuestionIndex++;
            
                        // Check if we've reached the end of questions
                        if (req.session.currentQuestionIndex < questions.length) {
                            const nextQuestion = questions[req.session.currentQuestionIndex];
                            botResponse = {
                                text: nextQuestion.text,
                                buttons: [
                                    { text: 'Yes', value: 1 },
                                    { text: 'No', value: 0 }
                                ]
                            };
                        } else {
                            // If all questions are answered, proceed to final step
                            const saveResult = await applicantController.saveScreeningScores(
                                userId, req.session.selectedPosition, req.session.screeningScores, req.session.resumeUrl
                            );
                        
                            if (saveResult.success) {
                                botResponse = {
                                    text: saveResult.message,
                                    buttons: saveResult.message.includes("not met the requirements") ? [] : [{ text: 'Upload Resume', type: 'file_upload' }]
                                };
                                
                                if (!saveResult.message.includes("not met the requirements")) {
                                    req.session.awaitingFileUpload = 'resume';
                                }
                            } else {
                                botResponse = { text: "There was an error processing your application. Please try again later." };
                            }
                        
                            req.session.applicantStage = (saveResult.message.includes("not met the requirements")) ? 
                                'rejected' : 'resume_upload';
                        }
                    }
                }
            }
            else if (applicantStage === 'file_upload') {
                if (req.session.awaitingFileUpload) {
                    const fileType = req.session.awaitingFileUpload;
                    console.log(`📂 [Chatbot] File Upload Detected: ${fileType}`);
            
                    const fileUrl = await fileUpload(req, fileType); // Upload file
            
                    let successMessage = "";
                    if (fileType === 'degree') {
                        req.session.degreeUrl = fileUrl;
                        console.log(`✅ [Chatbot] Degree Uploaded: ${fileUrl}`);
            
                        await supabase
                            .from('applicant_initialscreening_assessment')
                            .update({ degree_url: fileUrl })
                            .eq('userId', userId);
            
                        successMessage = "✅ Degree uploaded successfully. Let's continue.";
                    } else if (fileType === 'certification') {
                        req.session.certificationUrl = fileUrl;
                        console.log(`✅ [Chatbot] Certification Uploaded: ${fileUrl}`);
            
                        await supabase
                            .from('applicant_initialscreening_assessment')
                            .update({ cert_url: fileUrl })
                            .eq('userId', userId);
            
                        successMessage = "✅ Certification uploaded successfully. Let's continue.";
                    }
            
                    // Reset file upload status
                    delete req.session.awaitingFileUpload;
                    console.log(`🔄 [Chatbot] Awaiting file upload reset. Moving to next question.`);
            
                    // Save the success message in chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify({ text: successMessage }),
                            sender: 'bot',
                            timestamp,
                            applicantStage: req.session.applicantStage
                        }]);
            
                    // Update the question index and get the next question
                    req.session.currentQuestionIndex++;
                    console.log(`➡️ [Chatbot] Next Question Index: ${req.session.currentQuestionIndex}`);
            
                    if (req.session.currentQuestionIndex < req.session.screeningQuestions.length) {
                        const nextQuestion = req.session.screeningQuestions[req.session.currentQuestionIndex];
                        botResponse = {
                            text: successMessage,
                            nextQuestion: {
                                text: nextQuestion.text,
                                buttons: [
                                    { text: 'Yes', value: 1 },
                                    { text: 'No', value: 0 }
                                ]
                            }
                        };
                        
                        // Also save the next question to chat history for continuous flow
                        await supabase
                            .from('chatbot_history')
                            .insert([{
                                userId,
                                message: JSON.stringify({
                                    text: nextQuestion.text,
                                    buttons: [
                                        { text: 'Yes', value: 1 },
                                        { text: 'No', value: 0 }
                                    ]
                                }),
                                sender: 'bot',
                                timestamp: new Date(Date.now() + 1000).toISOString(), // Slight delay
                                applicantStage: req.session.applicantStage
                            }]);
                    } else {
                        // All questions answered, proceed to resume upload
                        botResponse = {
                            text: successMessage,
                            nextQuestion: {
                                text: "All screening questions have been completed. Please upload your resume.",
                                buttons: [{ text: 'Upload Resume', type: 'file_upload' }]
                            }
                        };
                        req.session.applicantStage = 'resume_upload';
                        req.session.awaitingFileUpload = 'resume';
                        
                        // Save the resume request to chat history
                        await supabase
                            .from('chatbot_history')
                            .insert([{
                                userId,
                                message: JSON.stringify({
                                    text: "All screening questions have been completed. Please upload your resume.",
                                    buttons: [{ text: 'Upload Resume', type: 'file_upload' }]
                                }),
                                sender: 'bot',
                                timestamp: new Date(Date.now() + 1000).toISOString(), // Slight delay
                                applicantStage: req.session.applicantStage
                            }]);
                    }
                    
                    // Send only one response
                    return res.status(200).json({ response: botResponse });
                } else {
                    console.log(`⚠️ [Chatbot] No pending file upload detected!`);
                }
            }


            else if (applicantStage === 'resume_upload' || (applicantStage === 'file_upload' && req.session.awaitingFileUpload === 'resume')) {
                console.log('📂 [Chatbot] Resume Upload Detected');
                
                // Assuming fileUpload function is already implemented and working
                const resumeUrl = await fileUpload(req, 'resume');
                
                if (resumeUrl) {
                    console.log(`✅ [Chatbot] Resume Uploaded: ${resumeUrl}`);
                    req.session.resumeUrl = resumeUrl;
                    
                    // Update the resume URL in the assessment table
                    await supabase
                        .from('applicant_initialscreening_assessment')
                        .update({ resume_url: resumeUrl })
                        .eq('userId', userId);
                    
                    // Now update the applicant status to 'P1 - Awaiting for HR Action'
                    const { data: updateStatusData, error: updateStatusError } = await supabase
                        .from('applicantaccounts')
                        .update({ applicantStatus: 'P1 - Awaiting for HR Action' })
                        .eq('userId', userId);
                    
                    if (updateStatusError) {
                        console.error('❌ [Chatbot] Error updating applicant status:', updateStatusError);
                        botResponse = { text: "Your resume was uploaded, but there was an error updating your application status. Please contact support." };
                    } else {
                        console.log('✅ [Chatbot] Applicant status updated to P1 - Awaiting for HR Action');
                        
                        // Update session applicant stage
                        req.session.applicantStage = 'P1 - Awaiting for HR Action';
                        
                        // Reset file upload flag
                        delete req.session.awaitingFileUpload;
                        
                        botResponse = { 
                            text: "Thank you for uploading your resume. Your application has been submitted and is now awaiting review by our HR team. You will be notified once a decision has been made." 
                        };
                    }
                    
                    // Save the bot response to chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify(botResponse),
                            sender: 'bot',
                            timestamp: new Date().toISOString(),
                            applicantStage: req.session.applicantStage
                        }]);
                    
                    return res.status(200).json({ response: botResponse });
                } else {
                    botResponse = { text: "There was an error uploading your resume. Please try again." };
                }
            }
            
            // Add new case to check for status change after resume upload
            else if (applicantStage === 'P1 - Awaiting for HR Action') {
                // Check if the status has been updated to P1 - PASSED
                const { data: applicantData, error: applicantError } = await supabase
                    .from('applicantaccounts')
                    .select('applicantStatus')
                    .eq('userId', userId)
                    .single();
    
                if (applicantError) {
                    console.error('❌ [Chatbot] Error checking applicant status:', applicantError);
                    botResponse = { text: "I'm waiting for an update from the HR team regarding your application." };
                } else if (applicantData && applicantData.applicantStatus === 'P1 - PASSED') {
                    // Status has changed to P1 - PASSED, send congratulations message
                    const congratsMessage = "Congratulations! We are delighted to inform you that you have successfully passed the initial screening process. We look forward to proceeding with the next interview stage once the HR team sets availability via Calendly.";
                    
                    botResponse = { text: congratsMessage };
                    req.session.applicantStage = 'P1 - PASSED';
                } else {
                    botResponse = { 
                        text: "Your application is currently being reviewed by our HR team. You will be notified once a decision has been made. Thank you for your patience."
                    };
                }
            }
            
            // ✅ Save bot response to chatbot history
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(botResponse),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
            
            res.status(200).json({ response: botResponse });
            
        } catch (error) {
            console.error('❌ [Chatbot] Error:', error);
            res.status(500).send('Internal Server Error');
        }
    },
    
    
// Function to fetch and structure all screening questions
getInitialScreeningQuestions: async function (jobId) {
    try {
        // Fetch job-related data
        const jobDetailsQueries = await Promise.all([
            supabase.from('jobreqdegrees').select('*').eq('jobId', jobId),
            supabase.from('jobreqexperiences').select('*').eq('jobId', jobId),
            supabase.from('jobreqcertifications').select('*').eq('jobId', jobId),
            supabase.from('jobreqskills').select('*').eq('jobId', jobId),
            supabase.from('jobpositions').select('*').eq('jobId', jobId), // Fetch job position details
        ]);

        // Check for errors
        const errors = jobDetailsQueries.filter(result => result.error);
        if (errors.length > 0) {
            console.error("Error fetching job details:", errors);
            return [];
        }

        // Extract data
        const [
            degreesQuery,
            experiencesQuery,
            certificationsQuery,
            skillsQuery,
            jobPositionQuery
        ] = jobDetailsQueries.map(result => result.data);

        // Check if job position data is available
        if (!jobPositionQuery || jobPositionQuery.length === 0) {
            console.error("Job position details not found.");
            return [];
        }

        const jobPosition = jobPositionQuery[0]; // Assuming one job position per job ID

        // Separate and sort skills by type
        const hardSkills = skillsQuery.filter(skill => skill.jobReqSkillType === 'Hard');
        const softSkills = skillsQuery.filter(skill => skill.jobReqSkillType === 'Soft');
        const sortedSkillsQuery = [...hardSkills, ...softSkills];

        // Map questions
        const questions = [
            ...degreesQuery.map(d => ({
                type: 'degree',
                text: `Do you have a degree related to ${d.jobReqDegreeType}: ${d.jobReqDegreeDescrpt}?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            })),
            ...experiencesQuery.map(e => ({
                type: 'experience',
                text: `Do you have ${e.jobReqExperienceType}: ${e.jobReqExperienceDescrpt}?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            })),
            ...certificationsQuery.map(c => ({
                type: 'certification',
                text: `Have you earned ${c.jobReqCertificateType}: ${c.jobReqCertificateDescrpt}?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            })),
            ...hardSkills.map(s => ({
                type: 'hardSkill',
                text: `To assess your hard skills, do you have experience with ${s.jobReqSkillName}?`,
                buttons: [
                  { text: 'Yes', value: 1 },
                  { text: 'No', value: 0 }
                ]
              })),
              ...softSkills.map(s => ({
                type: 'softSkill',
                text: `To assess your soft skills, do you possess ${s.jobReqSkillName}?`,
                buttons: [
                  { text: 'Yes', value: 1 },
                  { text: 'No', value: 0 }
                ]
              })),
            // Add work setup question
            {
                type: 'work_setup',
                text: `With regards to the work setup, are you comfortable working as ${jobPosition.jobType}?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            },
            // Add availability question
            {
                type: 'availability',
                text: `With regards to your availability, are you amenable to working ${jobPosition.jobTimeCommitment} from ${jobPosition.jobTimeCommitment_startTime} AM to ${jobPosition.jobTimeCommitment_endTime} PM?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            },
        ];

        return questions;
    } catch (error) {
        console.error("Error fetching screening questions:", error);
        return [];
    }
},


getJobPositionsList: async function() {
    try {
        const { data: jobpositions, error } = await supabase
            .from('jobpositions')
            .select('jobId, jobTitle');

        if (error) {
            console.error('❌ [Database] Error fetching job positions:', error.message);
            return []; // Return an empty array on error
        }

        console.log('✅ [Database] Fetched job positions:', jobpositions);

        if (!jobpositions || !Array.isArray(jobpositions)) {
            console.error('❌ [Database] Job positions data is invalid:', jobpositions);
            return [];
        }

        const jobTitles = jobpositions.map(position => position.jobTitle);
        console.log('🔹 [Processing] Extracted job titles:', jobTitles);

        return jobpositions.map(position => ({
            jobId: position.jobId,
            jobTitle: position.jobTitle
        }));
        
    } catch (error) {
        console.error('❌ [Server] Unexpected error:', error);
        return [];
    }
},


    getCalendly: async function (req, res) {
        res.render('applicant_pages/calendly', { errors: {} })
    },

    getOnboarding: async function(req, res) {
        res.render('applicant_pages/onboarding', { errors: {} });

    },

    postOnboarding: async function (req, res) {
        try {
            console.log('Received data:', req.body); // Debugging
    
            const { applicantId, checklist, signatures, managerVerified, notes } = req.body;
    
            // Validate required fields
            if (!applicantId || !managerVerified) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Applicant ID and manager verification are required.' 
                });
            }
    
    
            // Insert into the `onboarding` table
            const { data: onboardingData, error: onboardingError } = await supabase
                .from('onboarding')
                .insert([
                    {
                        applicantId: applicantId,
                        manager_signature: signatures['manager-signature-canvas'], // Manager's signature
                        notes: notes,
                        checklist_verified: managerVerified,
                        created_at: new Date().toISOString()
                    }
                ])
                .select('onboardingId');
    
            if (onboardingError) {
                console.error('Error inserting into onboarding table:', onboardingError);
                throw onboardingError;
            }
    
            console.log('Inserted into onboarding table:', onboardingData); // Debugging
    
            const onboardingId = onboardingData[0].onboardingId;
    
            // Prepare tasks data for insertion into `onboarding_tasks`
            const tasksData = checklist.map((task, index) => ({
                onboardingId: onboardingId, 
                applicantId: applicantId,
                taskId: index + 1, 
                taskName: task.task,
                contactPerson: task.contactPerson, 
                signature: signatures[`signature-canvas-${index + 1}`], 
                created_at: new Date().toISOString()
            }));
    
            // Insert tasks into the `onboarding_tasks` table
            const { data: tasksDataResult, error: tasksError } = await supabase
                .from('onboarding_tasks')
                .insert(tasksData);
    
            if (tasksError) {
                console.error('Error inserting into onboarding_tasks table:', tasksError);
                throw tasksError;
            }

            // Update applicant status
            await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'Onboarding - Checklist Completed' })
                .eq('applicantId', applicantId);
    
            console.log('Inserted into onboarding_tasks table:', tasksDataResult); 
    
            res.json({ success: true, message: 'Checklist saved successfully!', onboardingId });
        } catch (error) {
            console.error('Error saving checklist:', error);
            res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
        }
    },

    saveScreeningScores: async function (userId, jobPosition, responses, resumeUrl = null, degreeUrl = null, certificationUrl = null) {
        try {
            console.log('Saving screening scores for user:', userId);
            console.log('Resume URL:', resumeUrl);
            console.log('Degree URL:', degreeUrl);
            console.log('Certification URL:', certificationUrl);
    
            // Get jobId from the database using the position name
            const { data: jobData, error: jobError } = await supabase
                .from('jobpositions')
                .select('jobId')
                .ilike('jobTitle', jobPosition)
                .single();
    
            if (jobError || !jobData) {
                console.error('Error fetching job ID:', jobError);
                throw new Error('Error finding job position ID.');
            }
    
            const jobId = jobData.jobId;
            console.log(`Job ID: ${jobId}`);
    
            // Initialize category counters
            let degreeScore = 0;
            let experienceScore = 0;
            let certificationScore = 0;
            let hardSkillsScore = 0;
            let softSkillsScore = 0;
            let workSetupScore = false; // Changed variable name to match what's used later
            let availabilityScore = false; // Changed variable name to match what's used later
    
            // Count scores from responses
            if (responses && Array.isArray(responses)) {
                responses.forEach(response => {
                    switch (response.type) {
                        case 'degree': degreeScore += response.answer; break;
                        case 'experience': experienceScore += response.answer; break;
                        case 'certification': certificationScore += response.answer; break;
                        case 'hardSkill': hardSkillsScore += response.answer; break; 
                        case 'softSkill': softSkillsScore += response.answer; break;
                        case 'work_setup': workSetupScore = response.answer > 0; break; // Store as boolean
                        case 'availability': availabilityScore = response.answer > 0; break; // Store as boolean
                    }
                });
            }
    
            // Check if a record already exists
            const { data: existingRecord, error: checkError } = await supabase
                .from('applicant_initialscreening_assessment')
                .select('*')
                .eq('userId', userId)
                .eq('jobId', jobId)
                .maybeSingle();
    
            let result;
            
            // Calculate total score by adding only the numeric scores
            const totalScore = degreeScore + experienceScore + certificationScore + hardSkillsScore + softSkillsScore;
    
            if (existingRecord) {
                // Update existing record
                const updateData = {
                    degreeScore,
                    experienceScore,
                    certificationScore,
                    hardSkillsScore,
                    softSkillsScore,
                    workSetupScore, // Boolean
                    availabilityScore, // Boolean
                    totalScore,
                    totalScoreCalculatedAt: new Date(),
                };
    
                // Only update URLs if they are provided
                if (resumeUrl) updateData.resume_url = resumeUrl;
                if (degreeUrl) updateData.degree_url = degreeUrl;
                if (certificationUrl) updateData.cert_url = certificationUrl;
    
                result = await supabase
                    .from('applicant_initialscreening_assessment')
                    .update(updateData)
                    .eq('userId', userId)
                    .eq('jobId', jobId);
            } else {
                // Insert new record
                const insertData = {
                    userId,
                    jobId,
                    degreeScore,
                    experienceScore,
                    certificationScore,
                    hardSkillsScore,
                    softSkillsScore,
                    workSetupScore, // Boolean
                    availabilityScore, // Boolean
                    totalScore,
                    resume_url: resumeUrl,
                    degree_url: degreeUrl,
                    cert_url: certificationUrl,
                    totalScoreCalculatedAt: new Date(),
                };
    
                result = await supabase
                    .from('applicant_initialscreening_assessment')
                    .insert([insertData]);
            }
    
            if (result.error) {
                console.error('Error saving screening scores:', result.error);
                return { success: false, message: 'Error saving scores.' };
            }
    
            console.log('Screening scores saved successfully.');
            
            // Define the response message based on screening status
            let message = 'Screening scores saved.';
    
            // Automatic rejection if workSetupScore or availabilityScore is false
            if (!workSetupScore || !availabilityScore) {
                message = "We regret to inform you that you have not met the requirements for this position. Thank you for your interest in applying at Prime Infrastructure, and we wish you the best in your future endeavors.";
                return { success: true, message };
            }
    
            // If resume is uploaded and all screening is complete
            if (resumeUrl && responses && responses.length > 0) {
                // Update applicant status to "P1 - Awaiting for HR Action"
                const { data: statusData, error: statusError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P1 - Awaiting for HR Action' })
                    .eq('userId', userId);
                
                if (statusError) {
                    console.error('Error updating applicant status:', statusError);
                } else {
                    console.log('Applicant status updated to: P1 - Awaiting for HR Action');
                }
                
                message = "Thank you for answering, this marks the end of the initial screening process. We have forwarded your resume to the department's Line Manager, and we will notify you once a decision has been made.";
            }
            
            return { success: true, message };
    
        } catch (error) {
            console.error('Error in saveScreeningScores:', error);
            return { success: false, message: 'Internal error occurred.' };
        }
    },
    
    
    handleFileUpload: async function (req, res) {
        console.log('📂 [File Upload] Initiating file upload process...');
    
        try {
            const userId = req.session.userID;
            if (!userId) {
                console.error('❌ [File Upload] No user session found.');
                return res.status(400).send('User session not found.');
            }
    
            if (!req.files || !req.files.file) {
                console.log('❌ [File Upload] No file uploaded.');
                return res.status(400).send('No file uploaded.');
            }
    
            const file = req.files.file;
            console.log(`📎 [File Upload] File received: ${file.name} (Type: ${file.mimetype}, Size: ${file.size} bytes)`);
    
            // File validation
            const allowedTypes = [
                'application/pdf', 'image/jpeg', 'image/png',
                'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            ];
            const maxSize = 5 * 1024 * 1024; // 5 MB
            if (file.size > maxSize) {
                console.log('❌ [File Upload] File size exceeds the 5 MB limit.');
                return res.status(400).send('File size exceeds the 5 MB limit.');
            }
    
            // Generate unique file name
            const uniqueName = `${Date.now()}-${file.name}`;
            const filePath = path.join(__dirname, '../uploads', uniqueName);
    
            if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
                fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
            }
    
            await file.mv(filePath);
            console.log('📂 [File Upload] File successfully saved locally. Uploading to Supabase...');
    
            // Upload to Supabase
            const { error: uploadError } = await supabase.storage
                .from('uploads')
                .upload(uniqueName, fs.readFileSync(filePath), {
                    contentType: file.mimetype,
                    cacheControl: '3600',
                    upsert: false,
                });
    
            fs.unlinkSync(filePath); // Remove local file after upload
            console.log('📂 [File Upload] Local file deleted after upload to Supabase.');
    
            if (uploadError) {
                console.error('❌ [File Upload] Error uploading file to Supabase:', uploadError);
                return res.status(500).send('Error uploading file to Supabase.');
            }
    
            const fileUrl = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${uniqueName}`;
            console.log(`✅ [File Upload] File uploaded successfully: ${fileUrl}`);
    
            // Insert file metadata into database
            const { error: insertError } = await supabase
                .from('user_files')
                .insert([{
                    userId: userId,
                    file_name: uniqueName,
                    file_url: fileUrl,
                    uploaded_at: new Date(),
                    file_size: file.size,
                }]);
    
            if (insertError) {
                console.error('❌ [File Upload] Error inserting file metadata:', insertError);
                return res.status(500).send('Error inserting file metadata into database.');
            }
    
            console.log('✅ [File Upload] File metadata successfully inserted into database.');
    
            // Determine file type and update session & database
            const fileType = req.session.awaitingFileUpload;
            if (!fileType) {
                console.error('❌ [File Upload] Missing fileType in session.');
                return res.status(400).send('File type not specified.');
            }
    
            let updateField = {};
            let successMessage = "";
    
            if (fileType === 'degree') {
                req.session.degreeUrl = fileUrl;
                updateField = { degree_url: fileUrl };
                successMessage = "✅ Degree uploaded successfully. Let's continue.";
            } else if (fileType === 'certification') {
                req.session.certificationUrl = fileUrl;
                updateField = { cert_url: fileUrl };
                successMessage = "✅ Certification uploaded successfully. Let's continue.";
            } else if (fileType === 'resume') {
                req.session.resumeUrl = fileUrl;
                updateField = { resume_url: fileUrl };
                successMessage = "✅ Resume uploaded successfully. Thank you for answering, this marks the end of the initial screening process. We have forwarded your resume to the department's Line Manager, and we will notify you once a decision has been made.";
                
                // Update applicant status to 'P1 - Awaiting for HR Action'
                console.log('📂 [File Upload] Updating applicant status to P1 - Awaiting for HR Action...');
                const { error: statusError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P1 - Awaiting for HR Action' })
                    .eq('userId', userId);
                
                if (statusError) {
                    console.error('❌ [File Upload] Error updating applicant status:', statusError);
                    return res.status(500).send('Error updating applicant status.');
                } else {
                    console.log('✅ [File Upload] Applicant status updated to P1 - Awaiting for HR Action');
                }
                
                // Calculate and update total score
                const { data: assessmentData } = await supabase
                    .from('applicant_initialscreening_assessment')
                    .select('*')
                    .eq('userId', userId)
                    .single();
                    
                if (assessmentData) {
                    const totalScore = (
                        (assessmentData.degreeScore || 0) + 
                        (assessmentData.experienceScore || 0) + 
                        (assessmentData.certificationScore || 0) + 
                        (assessmentData.hardSkillsScore || 0) + 
                        (assessmentData.softSkillsScore || 0)
                    );
                    
                    updateField = { 
                        ...updateField, 
                        totalScore: totalScore,
                        totalScoreCalculatedAt: new Date()
                    };
                }
            }
    
            // Update database
            const { error: updateError } = await supabase
                .from('applicant_initialscreening_assessment')
                .update(updateField)
                .eq('userId', userId);
    
            if (updateError) {
                console.error('❌ [File Upload] Database update failed:', updateError);
                return res.status(500).send('Error updating applicant record.');
            }
    
            // Save success message to chat history
            const timestamp = new Date().toISOString();
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify({ text: successMessage }),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
    
            // Remove awaiting upload flag after successful upload
            delete req.session.awaitingFileUpload;
            
            // Prepare the next question (if not final upload)
            let nextResponse = { text: successMessage };
            
            // Only for degree and certification uploads, proceed to next question
            if (fileType !== 'resume') {
                // Increment question index to move to next question
                req.session.currentQuestionIndex++;
                
                if (req.session.currentQuestionIndex < req.session.screeningQuestions.length) {
                    const nextQuestion = req.session.screeningQuestions[req.session.currentQuestionIndex];
                    
                    // Add the next question as part of the response
                    nextResponse = {
                        text: successMessage,
                        nextQuestion: {
                            text: nextQuestion.text,
                            buttons: [
                                { text: 'Yes', value: 1 },
                                { text: 'No', value: 0 }
                            ]
                        }
                    };
                    
                    // Also save the next question to chat history for continuous flow
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify({
                                text: nextQuestion.text,
                                buttons: [
                                    { text: 'Yes', value: 1 },
                                    { text: 'No', value: 0 }
                                ]
                            }),
                            sender: 'bot',
                            timestamp: new Date(Date.now() + 1000).toISOString(), // Slight delay
                            applicantStage: req.session.applicantStage
                        }]);
                } else if (fileType === 'certification' || fileType === 'degree') {
                    // If all questions are answered after certification/degree
                    nextResponse = {
                        text: successMessage,
                        nextQuestion: {
                            text: "All screening questions have been completed. Please upload your resume.",
                            buttons: [{ text: 'Upload Resume', type: 'file_upload' }]
                        }
                    };
                    
                    req.session.applicantStage = 'resume_upload';
                    req.session.awaitingFileUpload = 'resume';
                    
                    // Save the resume request to chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify({
                                text: "All screening questions have been completed. Please upload your resume.",
                                buttons: [{ text: 'Upload Resume', type: 'file_upload' }]
                            }),
                            sender: 'bot',
                            timestamp: new Date(Date.now() + 1000).toISOString(), // Slight delay
                            applicantStage: 'resume_upload'
                        }]);
                }
            }
            
            console.log('✅ [File Upload] Response prepared:', nextResponse);
            // Send only one response
            return res.status(200).json({ response: nextResponse });
    
        } catch (error) {
            console.error('❌ [File Upload] Unexpected error:', error);
            return res.status(500).send('An unexpected error occurred.');
        }
    },

/* STATUS UPDATE FUNCTIONS */
updateApplicantJobAndDepartmentOnATS: async function (userId, jobId, departmentId) {
    try {
        if (!userId || !jobId || !departmentId) {
            return { success: false, message: "Missing userId, jobId, or departmentId." };
        }
        const { error } = await supabase
            .from('applicantaccounts')
            .update({ jobId: jobId, departmentId: departmentId })
            .eq('userId', userId);
        
        if (error) {
            console.error("Error updating applicant job and department:", error);
            return { success: false, message: "Error updating applicant job and department." };
        }
        return { success: true, message: "Applicant job and department updated successfully." };
    } catch (err) {
        console.error("Unexpected error in updateApplicantJobAndDepartment:", err);
        return { success: false, message: "Unexpected error occurred." };
    }
},

updateApplicantStatusToP1Initial: async function (userId) {
    try {
        if (!userId) {
            throw new Error("User ID is missing.");
        }

        const { error } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'P1 - Initial screening' })
            .eq('userId', userId);

        if (error) {
            console.error("Error updating applicant status:", error);
            return { success: false, message: "Error updating applicant status." };
        }

        return { success: true, message: "Applicant status updated successfully." };
    } catch (err) {
        console.error("Unexpected error:", err);
        return { success: false, message: "Unexpected error occurred." };
    }
},

updateApplicantStatusFinalizeP1Review: async function (userId) {
    try {
        const { passedUserIds, failedUserIds, phase } = req.body;
        
        if (!passedUserIds || !failedUserIds) {
            return res.status(400).json({ success: false, message: "Missing required data" });
        }
        
        console.log(`Finalizing ${phase} review for ${passedUserIds.length} passed and ${failedUserIds.length} failed applicants`);
        
        // Update passed applicants
        if (passedUserIds.length > 0) {
            const { data: passedData, error: passedError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: `${phase} - PASSED` })
                .in('userId', passedUserIds);
                
            if (passedError) {
                console.error(`Error updating passed applicants:`, passedError);
                return res.status(500).json({ success: false, message: "Error updating passed applicants" });
            }
        }
        
        // Update failed applicants
        if (failedUserIds.length > 0) {
            const { data: failedData, error: failedError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: `${phase} - FAILED` })
                .in('userId', failedUserIds);
                
            if (failedError) {
                console.error(`Error updating failed applicants:`, failedError);
                return res.status(500).json({ success: false, message: "Error updating failed applicants" });
            }
        }
        
        // Send success response
        return res.status(200).json({ 
            success: true, 
            message: `Successfully finalized ${phase} review for ${passedUserIds.length + failedUserIds.length} applicants` 
        });
        
    } catch (error) {
        console.error("Error finalizing review:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
},


getOnboarding: async function(req, res) {
    res.render('applicant_pages/onboarding', { errors: {} });
},

getOnboardingEmployeeRecords: async function(req, res) {
    res.render('applicant_pages/onboarding-employee-records', { errors: {} });
},

getOnboardingWaitOSD: async function(req, res) {
    res.render('applicant_pages/onboarding-waiting-osd', { errors: {} });
},

getOnboardingObjectiveSetting: async function(req, res) {
    res.render('applicant_pages/onboarding-object-setting', { errors: {} });
},

getLogoutButton: function(req, res) {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.redirect('/applicant/login');
    });
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