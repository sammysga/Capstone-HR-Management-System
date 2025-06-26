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

    handleLoginCheckEmail: async function (req, res) {
        try {
        const { email } = req.body;
        
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.json({ 
                exists: false, 
                valid: false, 
                message: 'Invalid email format' 
            });
        }

        // Check if email already exists in database
        const { data: existingData, error: existingDataError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userEmail', email)
            .limit(1);

        if (existingDataError) {
            console.error('Database error checking email:', existingDataError);
            return res.status(500).json({ 
                error: 'Database error occurred' 
            });
        }

        const emailExists = existingData && existingData.length > 0;

        res.json({
            exists: emailExists,
            valid: true,
            message: emailExists ? 'Email is already registered' : 'Email is available'
        });

    } catch (error) {
        console.error('Error in email check:', error);
        res.status(500).json({ 
            error: 'Server error occurred' 
        });
    }
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

        // Check if user is authenticated
        if (!userId) {
            console.log('❌ [getChatbotPage] User not authenticated. Redirecting to login...');
            return res.redirect('/applicant/login');
        }

        // Check if there's already chat history in the session
        let chatData = req.session.chatHistory || [];
        let initialResponse = {};

        // Always define an initialResponse (even if empty)
        const initialMessage = "Hi! Welcome to Prime Infrastructure Recruitment Screening Portal. What position are you going to apply for?";

        // If no chat history in session, fetch it from Supabase
        if (chatData.length === 0) {
            console.log('✅ [getChatbotPage] No chat history in session. Fetching from database...');

            const { data: chatHistory, error } = await supabase
                .from('chatbot_history')
                .select('message, sender, timestamp, applicantStage')
                .eq('userId', userId)
                .order('timestamp', { ascending: true });

            if (error) {
                console.error('❌ [getChatbotPage] Error fetching chat history from database:', error);
            }

            if (chatHistory && chatHistory.length > 0) {
                console.log('✅ [getChatbotPage] Chat history found in database. Restoring session state...');

                // Map the fetched data to session format
                chatData = chatHistory.map(chat => ({
                    message: chat.message,
                    sender: chat.sender,
                    timestamp: chat.timestamp,
                    applicantStage: chat.applicantStage
                }));

                // 🔥 NEW: Restore session state from chat history
                await this.restoreSessionFromChatHistory(req, chatHistory, userId);

                // Store it in the session for faster loading next time
                req.session.chatHistory = chatData;
                console.log('✅ [getChatbotPage] Chat history and session state restored.');
            } else {
                console.log('✅ [getChatbotPage] No chat history in database. Preparing initial message.');

                try {
                    // Fetch job positions from your controller
                    const positions = await applicantController.getActiveJobPositionsList();
                    console.log('✅ [getChatbotPage] Job positions fetched successfully:', positions);

                    // Prepare the initial response
                    initialResponse = {
                        text: `${initialMessage}\nHere are our current job openings:`,
                        buttons: positions.map(pos => ({
                            text: pos.jobTitle,
                            value: pos.jobTitle
                        }))
                    };

                    // Push the initial message to chat history
                    chatData.push({
                        message: JSON.stringify(initialResponse),
                        sender: 'bot',
                        timestamp: new Date().toISOString()
                    });

                    // Save it in session
                    req.session.chatHistory = chatData;
                } catch (jobError) {
                    console.error("❌ [getChatbotPage] Error fetching job positions:", jobError);
                    initialResponse = { text: initialMessage, buttons: [] };
                }
            }
        }

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

// 🔥 NEW FUNCTION: Restore session state from chat history
restoreSessionFromChatHistory: async function(req, chatHistory, userId) {
    try {
        console.log('🔄 [Restore] Restoring session state from chat history...');
        
        let selectedPosition = null;
        let currentQuestionIndex = 0;
        let screeningQuestions = null;
        let screeningScores = [];
        let applicantStage = 'initial';
        let awaitingFileUpload = null;
        
        // Analyze chat history to restore state
        for (const chat of chatHistory) {
            // Update applicant stage
            if (chat.applicantStage) {
                applicantStage = chat.applicantStage;
            }
            
            // Look for job selection
            if (chat.sender === 'user' && !selectedPosition) {
                try {
                    const positions = await this.getActiveJobPositionsList();
                    const foundPosition = positions.find(pos => 
                        chat.message.toLowerCase().includes(pos.jobTitle.toLowerCase())
                    );
                    if (foundPosition) {
                        selectedPosition = foundPosition.jobTitle;
                        console.log('🔄 [Restore] Found selected position:', selectedPosition);
                    }
                } catch (error) {
                    console.error('❌ [Restore] Error finding position:', error);
                }
            }
            
            // Count screening question answers
            if (chat.sender === 'user' && (chat.message.toLowerCase().includes('yes') || chat.message.toLowerCase().includes('no'))) {
                if (applicantStage === 'screening_questions' || applicantStage === 'file_upload') {
                    // This was likely a screening question answer
                    screeningScores.push({
                        answer: chat.message.toLowerCase().includes('yes') ? 1 : 0,
                        timestamp: chat.timestamp
                    });
                }
            }
            
            // Check for file upload requests
            if (chat.sender === 'bot') {
                try {
                    const botMessage = JSON.parse(chat.message);
                    if (botMessage.buttons) {
                        const fileUploadButton = botMessage.buttons.find(btn => 
                            btn.type === 'file_upload' || btn.type === 'file_upload_reupload'
                        );
                        if (fileUploadButton) {
                            if (botMessage.text.includes('degree')) {
                                awaitingFileUpload = 'degree';
                            } else if (botMessage.text.includes('certification')) {
                                awaitingFileUpload = 'certification';
                            } else if (botMessage.text.includes('resume')) {
                                awaitingFileUpload = 'resume';
                            } else {
                                awaitingFileUpload = 'reupload';
                            }
                        }
                    }
                } catch (e) {
                    // Not JSON, skip
                }
            }
        }
        
        // Get screening questions if we have a selected position
        if (selectedPosition && !screeningQuestions) {
            try {
                const jobDetails = await this.getJobDetailsbyTitle(selectedPosition);
                if (jobDetails && jobDetails.jobId) {
                    screeningQuestions = await this.getInitialScreeningQuestions(jobDetails.jobId);
                    currentQuestionIndex = screeningScores.length;
                    console.log('🔄 [Restore] Loaded screening questions, current index:', currentQuestionIndex);
                }
            } catch (error) {
                console.error('❌ [Restore] Error loading screening questions:', error);
            }
        }
        
        // Restore session variables
        req.session.selectedPosition = selectedPosition;
        req.session.currentQuestionIndex = currentQuestionIndex;
        req.session.screeningQuestions = screeningQuestions;
        req.session.screeningScores = screeningScores;
        req.session.applicantStage = applicantStage;
        if (awaitingFileUpload) {
            req.session.awaitingFileUpload = awaitingFileUpload;
        }
        
        // Initialize screening counters
        req.session.screeningCounters = req.session.screeningCounters || {
            degree: 0, experience: 0, certification: 0,
            hardSkill: 0, softSkill: 0, work_setup: 0, availability: 0
        };
        
        console.log('✅ [Restore] Session state restored:', {
            selectedPosition,
            currentQuestionIndex,
            applicantStage,
            awaitingFileUpload,
            hasScreeningQuestions: !!screeningQuestions
        });
        
    } catch (error) {
        console.error('❌ [Restore] Error restoring session state:', error);
    }
},handleChatbotMessage: async function (req, res) {
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

        // Handle status_check command first (before saving to chat history)
// Update the status_check section in your handleChatbotMessage function

// Handle status_check command first (before saving to chat history)
if (userMessage === 'status_check') {
    console.log('📋 [Chatbot] Status check requested - NOT saving to chat history');
    
    // Check applicant status for reupload requests
    const { data: applicantStatusData, error: applicantStatusError } = await supabase
        .from('applicantaccounts')
        .select('applicantStatus')
        .eq('userId', userId)
        .single();
    
    if (!applicantStatusError && applicantStatusData && 
        applicantStatusData.applicantStatus.includes('Requested for Reupload')) {
        
        console.log('📋 [Chatbot] Found reupload request in applicant status');
        
        // Check for document reupload requests
        const { data: assessmentData, error: assessmentError } = await supabase
            .from('applicant_initialscreening_assessment')
            .select('hrVerification')
            .eq('userId', userId)
            .single();
        
        if (!assessmentError && assessmentData && assessmentData.hrVerification) {
            let reuploadData;
            try {
                reuploadData = JSON.parse(assessmentData.hrVerification);
            } catch (e) {
                // Fallback for old format
                reuploadData = {
                    documentsRequested: ['additional'],
                    remarks: assessmentData.hrVerification
                };
            }
            
            console.log('📋 [Chatbot] Found reupload data:', reuploadData);
            
            const documentNames = reuploadData.documentsRequested.map(doc => {
                switch(doc) {
                    case 'degree': return 'Degree Certificate';
                    case 'certification': return 'Certification Document';
                    case 'resume': return 'Resume';
                    case 'additional': return 'Additional Document';
                    default: return doc;
                }
            });
            
            const botResponse = {
                text: `Hello! We have reviewed your application and would like to request some document updates. Please re-upload the following documents: ${documentNames.join(', ')}. 
            
HR Instructions: ${reuploadData.remarks}
            
Please upload each requested document using the buttons below. You need to upload ${reuploadData.documentsRequested.length} document(s).`,
                // 🔥 CRITICAL FIX: Create buttons for each document type
                buttons: reuploadData.documentsRequested.map(docType => ({
                    text: `Upload ${documentNames[reuploadData.documentsRequested.indexOf(docType)]}`,
                    type: 'file_upload_reupload',
                    docType: docType
                })),
                reuploadData: reuploadData
            };
            
            // Set the applicant stage to expect file upload
            req.session.applicantStage = 'file_upload_reupload';
            req.session.awaitingFileUpload = 'reupload';
            req.session.reuploadData = reuploadData; // Store in session
            
            // Save bot response (but NOT the status_check user message)
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(botResponse),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
            
            console.log('✅ [Chatbot] Reupload request with multiple buttons sent to user');
            return res.status(200).json({ response: botResponse });
        }
    }
    
    // If no reupload request, return null (no message to display)
    console.log('📋 [Chatbot] No reupload request - returning empty response');
    return res.status(200).json({ response: null });
}

if (userMessage === 'check_reupload_progress') {
    console.log('📋 [Chatbot] Reupload progress check requested');
    
    // Get current reupload status
    const { data: assessmentData, error: assessmentError } = await supabase
        .from('applicant_initialscreening_assessment')
        .select('hrVerification, degree_url, cert_url, resume_url, addtlfile_url')
        .eq('userId', userId)
        .single();
    
    if (assessmentError || !assessmentData || !assessmentData.hrVerification) {
        console.log('📋 [Chatbot] No active reupload request found');
        return res.status(200).json({ response: null });
    }
    
    let reuploadData;
    try {
        reuploadData = JSON.parse(assessmentData.hrVerification);
    } catch (e) {
        console.log('📋 [Chatbot] Invalid reupload data format');
        return res.status(200).json({ response: null });
    }
    
    // Check which documents have been uploaded
    const uploadedDocs = [];
    const documentFields = {
        'degree': assessmentData.degree_url,
        'certification': assessmentData.cert_url,
        'resume': assessmentData.resume_url,
        'additional': assessmentData.addtlfile_url
    };
    
    reuploadData.documentsRequested.forEach(docType => {
        if (documentFields[docType]) {
            uploadedDocs.push(docType);
        }
    });
    
    console.log('📋 [Chatbot] Requested docs:', reuploadData.documentsRequested);
    console.log('📋 [Chatbot] Uploaded docs:', uploadedDocs);
    
    // Check if all documents have been uploaded
    const allUploaded = reuploadData.documentsRequested.every(doc => uploadedDocs.includes(doc));
    
    if (allUploaded) {
        console.log('✅ [Chatbot] All documents uploaded - completing reupload process');
        
        // Update applicant status
        await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: "P1 - Awaiting for HR Action" })
            .eq('userId', userId);
        
        // Clear HR verification
        await supabase
            .from('applicant_initialscreening_assessment')
            .update({ hrVerification: null })
            .eq('userId', userId);
        
        const completionMessage = {
            text: "Thank you for uploading all requested documents. Your application has been submitted and is now awaiting review by our HR team. You will be notified once a decision has been made."
        };
        
        // Save completion message
        await supabase
            .from('chatbot_history')
            .insert([{
                userId,
                message: JSON.stringify(completionMessage),
                sender: 'bot',
                timestamp,
                applicantStage: "P1 - Awaiting for HR Action"
            }]);
        
        req.session.applicantStage = "P1 - Awaiting for HR Action";
        return res.status(200).json({ response: completionMessage });
    } else {
        // Some documents are still missing
        const remainingDocs = reuploadData.documentsRequested.filter(doc => !uploadedDocs.includes(doc));
        const remainingDocNames = remainingDocs.map(doc => {
            switch(doc) {
                case 'degree': return 'Degree Certificate';
                case 'certification': return 'Certification Document';
                case 'resume': return 'Resume';
                case 'additional': return 'Additional Document';
                default: return doc;
            }
        });
        
        const progressMessage = {
            text: `You still need to upload the following document(s): ${remainingDocNames.join(', ')}.`,
            buttons: remainingDocs.map(docType => ({
                text: `Upload ${remainingDocNames[remainingDocs.indexOf(docType)]}`,
                type: 'file_upload_reupload',
                docType: docType
            }))
        };
        
        console.log('📋 [Chatbot] Sending progress update with remaining documents');
        return res.status(200).json({ response: progressMessage });
    }
}

        // Handle conversation restoration after page refresh
        if (userMessage === 'continue_after_upload') {
            console.log('🔄 [Restore] Continue after upload requested');
            
            const stage = req.body.stage || req.session.applicantStage;
            console.log('🔄 [Restore] Current stage:', stage);
            
            // Check what type of file upload was completed and continue accordingly
            if (stage === 'file_upload' && req.session.screeningQuestions) {
                // User was in the middle of screening questions with file upload
                const currentIndex = req.session.currentQuestionIndex || 0;
                const questions = req.session.screeningQuestions;
                
                if (currentIndex < questions.length) {
                    // Continue with next question
                    const nextQuestion = questions[currentIndex];
                    const botResponse = {
                        text: nextQuestion.text,
                        buttons: [
                            { text: 'Yes', value: 1 },
                            { text: 'No', value: 0 }
                        ]
                    };
                    
                    req.session.applicantStage = 'screening_questions';
                    
                    // Save to chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify(botResponse),
                            sender: 'bot',
                            timestamp,
                            applicantStage: req.session.applicantStage
                        }]);
                    
                    return res.status(200).json({ response: botResponse });
                } else {
                    // All questions completed, proceed to resume upload
                    const botResponse = {
                        text: "All screening questions have been completed. Please upload your resume.",
                        buttons: [{ text: 'Upload Resume', type: 'file_upload' }]
                    };
                    
                    req.session.applicantStage = 'resume_upload';
                    req.session.awaitingFileUpload = 'resume';
                    
                    // Save to chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify(botResponse),
                            sender: 'bot',
                            timestamp,
                            applicantStage: req.session.applicantStage
                        }]);
                    
                    return res.status(200).json({ response: botResponse });
                }
            }
            
            // If no specific continuation needed, return empty response
            return res.status(200).json({ response: null });
        }

        // Save user message (for all messages except status_check and continue_after_upload)
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

            // Handle P2 - PASSED status
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
                                    url: "/applicant/schedule-interview?stage=P2"
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
                                    url: "/applicant/schedule-interview?stage=P2"
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

        // Continue with the rest of your logic...
        
        let botResponse;
        let applicantStage = req.session.applicantStage || 'initial';
        console.log(`Initial Applicant Stage: ${applicantStage}`);

        // Fetch job positions with null check
        const positions = await applicantController.getActiveJobPositionsList();
        console.log('Today:', today);
        console.log('Query parameters:', {
            hiringEndDateGte: today,
            hiringStartDateLte: today
        });
        
        // Fixed positions array check
        const selectedPosition = positions && positions.length > 0 
            ? positions.find(position => userMessage.includes(position.jobTitle.toLowerCase()))?.jobTitle 
            : null;

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
                    jobDetails.departmentId
                );
                if (!updateJobResult.success) {
                    console.error(updateJobResult.message);
                    botResponse = "Error updating your application details. Please try again later.";
                    
                    // Save error response to chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify({ text: botResponse }),
                            sender: 'bot',
                            timestamp,
                            applicantStage: req.session.applicantStage
                        }]);
                        
                    return res.status(500).json({ response: botResponse });
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
                
                // Save bot response to chat history
                await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify(botResponse),
                        sender: 'bot',
                        timestamp,
                        applicantStage: req.session.applicantStage
                    }]);
            } else {
                botResponse = "Sorry, I couldn't find the job details.";
                
                // Save error response to chat history
                await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: botResponse }),
                        sender: 'bot',
                        timestamp,
                        applicantStage: req.session.applicantStage
                    }]);
            }
            
            // Return the response
            return res.status(200).json({ response: botResponse });
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

            // Retrieve Screening Questions
            if (!req.session.screeningQuestions) {
                const questions = await applicantController.getInitialScreeningQuestions(jobId);
                if (!questions || questions.length === 0) {
                    botResponse = "No screening questions available for this position.";
                    
                    // Save error response to chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify({ text: botResponse }),
                            sender: 'bot',
                            timestamp,
                            applicantStage: req.session.applicantStage
                        }]);
                        
                    return res.status(200).json({ response: botResponse });
                }

                req.session.screeningQuestions = questions;
                req.session.currentQuestionIndex = 0;
                req.session.screeningScores = [];
            }

            // Ask the first question
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
            
            // Save bot response to chat history
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(botResponse),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
                
            return res.status(200).json({ response: botResponse });

        // Process Answered Questions
        } else if (applicantStage === 'screening_questions') {
            const questions = req.session.screeningQuestions;
            const currentIndex = req.session.currentQuestionIndex;
        
            if (currentIndex < questions.length) {
                const currentQuestion = questions[currentIndex];
                const answerValue = userMessage.includes('yes') ? 1 : 0;
        
                // Track the type of question being answered
                const questionType = currentQuestion.type;
        
                // Store the question and answer
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
                    req.session.applicantStage = 'file_upload'; // Change stage to file_upload
                    
                    botResponse = {
                        text: "Please upload your degree certificate.",
                        buttons: [{ text: 'Upload Degree File', type: 'file_upload' }]
                    };
                    
                    // Save request to chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify(botResponse),
                            sender: 'bot',
                            timestamp,
                            applicantStage: req.session.applicantStage
                        }]);
                    
                    // Don't increment question index here - it will be incremented after file upload
                    return res.status(200).json({ response: botResponse });
                }
        
                if (questionType === 'certification' && answerValue === 1) {
                    req.session.awaitingFileUpload = 'certification';
                    req.session.applicantStage = 'file_upload'; // Change stage to file_upload
                    
                    botResponse = {
                        text: "Please upload your certification document.",
                        buttons: [{ text: 'Upload Certification File', type: 'file_upload' }]
                    };
                    
                    // Save request to chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify(botResponse),
                            sender: 'bot',
                            timestamp,
                            applicantStage: req.session.applicantStage
                        }]);
                    
                    // Don't increment question index here - it will be incremented after file upload
                    return res.status(200).json({ response: botResponse });
                }
        
                // Automatic rejection for work setup or availability
                // Replace the automatic rejection section in your screening_questions handler

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

    // Save scores to the database
    const saveResult = await applicantController.saveScreeningScores(
        userId, req.session.selectedPosition, req.session.screeningScores, req.session.resumeUrl
    );

    // 🔥 CRITICAL FIX: Update applicant status in database to P1 - FAILED
    console.log('❌ [Chatbot] Updating applicant status to P1 - FAILED due to work setup/availability rejection');
    
    const { data: updateStatusData, error: updateStatusError } = await supabase
        .from('applicantaccounts')
        .update({ applicantStatus: 'P1 - FAILED' })
        .eq('userId', userId);
    
    if (updateStatusError) {
        console.error('❌ [Chatbot] Error updating applicant status to P1 - FAILED:', updateStatusError);
        // Continue with rejection message even if status update fails
    } else {
        console.log('✅ [Chatbot] Applicant status successfully updated to P1 - FAILED');
    }

    // Rejection message
    const rejectionMessage = {
        text: "We regret to inform you that you have not met the requirements for this position. Thank you for your interest in applying at Prime Infrastructure, and we wish you the best in your future endeavors."
    };
    
    // Update session applicant stage
    req.session.applicantStage = 'P1 - FAILED';
    
    // Save rejection to chat history
    await supabase
        .from('chatbot_history')
        .insert([{
            userId,
            message: JSON.stringify(rejectionMessage),
            sender: 'bot',
            timestamp,
            applicantStage: req.session.applicantStage
        }]);
        
    return res.status(200).json({ response: rejectionMessage });

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
                        
                        // Save next question to chat history
                        await supabase
                            .from('chatbot_history')
                            .insert([{
                                userId,
                                message: JSON.stringify(botResponse),
                                sender: 'bot',
                                timestamp,
                                applicantStage: req.session.applicantStage
                            }]);
                            
                        return res.status(200).json({ response: botResponse });
                    } else {
                        // If all questions are answered, proceed to final step
                       const saveResult = await applicantController.saveScreeningScores(
        userId, req.session.selectedPosition, req.session.screeningScores, req.session.resumeUrl
    );

    if (saveResult.success) {
        // 🔥 CRITICAL FIX: Handle different result types
        if (saveResult.isRejected) {
            console.log('❌ [Chatbot] Final scoring resulted in rejection');
            
            // Update session stage for rejected applications
            req.session.applicantStage = 'P1 - FAILED';
            
            botResponse = {
                text: saveResult.message,
                buttons: [] // No buttons for rejected applications
            };
        } else if (saveResult.passes) {
            console.log('✅ [Chatbot] Final scoring - applicant passed');
            
            // Applicant passed, proceed to resume upload
            req.session.awaitingFileUpload = 'resume';
            req.session.applicantStage = 'resume_upload';
            
            botResponse = {
                text: saveResult.message,
                buttons: [{ text: 'Upload Resume', type: 'file_upload' }]
            };
        } else {
            console.log('❌ [Chatbot] Final scoring - applicant failed');
            
            // Applicant failed due to low score
            req.session.applicantStage = 'P1 - FAILED';
            
            botResponse = {
                text: saveResult.message,
                buttons: [] // No buttons for failed applications
            };
        }
    } else {
        // Error in processing
        console.error('❌ [Chatbot] Error in saveScreeningScores:', saveResult.error);
        
        botResponse = { 
            text: "There was an error processing your application. Please try again later." 
        };
        
        // Don't change the applicant stage if there was an error
    }

    // Save final message to chat history
    await supabase
        .from('chatbot_history')
        .insert([{
            userId,
            message: JSON.stringify(botResponse),
            sender: 'bot',
            timestamp,
            applicantStage: req.session.applicantStage
        }]);
        
    return res.status(200).json({ response: botResponse });
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

                // Save success message to chat history
                await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: successMessage }),
                        sender: 'bot',
                        timestamp,
                        applicantStage: req.session.applicantStage
                    }]);

                // Change stage back to screening_questions
                req.session.applicantStage = 'screening_questions';

                // Increment question index after file upload
                req.session.currentQuestionIndex++;
                console.log(`➡️ [Chatbot] Next Question Index: ${req.session.currentQuestionIndex}`);

                // Check if there are more questions
                if (req.session.currentQuestionIndex < req.session.screeningQuestions.length) {
                    const nextQuestion = req.session.screeningQuestions[req.session.currentQuestionIndex];
                    
                    // Save next question to chat history
                    const nextQuestionResponse = {
                        text: nextQuestion.text,
                        buttons: [
                            { text: 'Yes', value: 1 },
                            { text: 'No', value: 0 }
                        ]
                    };
                    
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify(nextQuestionResponse),
                            sender: 'bot',
                            timestamp: new Date(Date.now() + 1000).toISOString(), // Slight delay
                            applicantStage: req.session.applicantStage
                        }]);
                    
                    botResponse = {
                        text: successMessage,
                        nextMessage: nextQuestionResponse
                    };
                } else {
                    // All questions answered, proceed to resume upload
                    const resumeUploadMessage = {
                        text: "All screening questions have been completed. Please upload your resume.",
                        buttons: [{ text: 'Upload Resume', type: 'file_upload' }]
                    };
                    
                    // Save resume upload request to chat history
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify(resumeUploadMessage),
                            sender: 'bot',
                            timestamp: new Date(Date.now() + 1000).toISOString(),
                            applicantStage: 'resume_upload'
                        }]);
                    
                    req.session.applicantStage = 'resume_upload';
                    req.session.awaitingFileUpload = 'resume';
                    
                    botResponse = {
                        text: successMessage,
                        nextMessage: resumeUploadMessage
                    };
                }
                
                // Return response immediately
                return res.status(200).json({ response: botResponse });
            } else {
                console.log(`⚠️ [Chatbot] No pending file upload detected!`);
                botResponse = { text: "No file upload is currently expected. Please continue with the screening questions." };
                
                // Save error message to chat history
                await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify(botResponse),
                        sender: 'bot',
                        timestamp,
                        applicantStage: req.session.applicantStage
                    }]);
                    
                return res.status(200).json({ response: botResponse });
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
                        text: "✅ Resume uploaded successfully. Thank you for answering, this marks the end of the initial screening process. We have forwarded your resume to the HR department , and we will notify you once a decision has been made." 
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
                
                // Save error message to chat history
                await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify(botResponse),
                        sender: 'bot',
                        timestamp,
                        applicantStage: req.session.applicantStage
                    }]);
                    
                return res.status(200).json({ response: botResponse });
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
            
            // Save bot response to chat history
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(botResponse),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
                
            return res.status(200).json({ response: botResponse });
        }
        
        // Handle "No" response to job application continuation
        else if (applicantStage === 'job_selection' && userMessage.includes('no')) {
            botResponse = {
                text: "Thank you for your interest. Feel free to explore other positions or return when you're ready to apply."
            };
            
            req.session.applicantStage = 'initial';
            
            // Save response to chat history
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(botResponse),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
                
            return res.status(200).json({ response: botResponse });
        }
        
        // Handle file upload reupload scenarios
        else if (applicantStage === 'file_upload_reupload') {
            console.log('📂 [Chatbot] Document reupload scenario detected');
            
            // This would be handled by the handleReuploadsFileUpload function
            // which is called from the frontend when a file is actually uploaded
            botResponse = { 
                text: "Please use the file upload button to submit your requested document." 
            };
            
            // Save response to chat history
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(botResponse),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
                
            return res.status(200).json({ response: botResponse });
        }
        
        // Handle final application stages
        else if (applicantStage === 'P1 - PASSED' || applicantStage === 'P2 - PASSED' || 
                 applicantStage === 'P3 - Awaiting for Line Manager Evaluation' ||
                 applicantStage === 'P2 - Awaiting for HR Evaluation') {
            
            botResponse = { 
                text: "Your application is currently in progress. You will be notified of any updates via email or through this chat system." 
            };
            
            // Save response to chat history
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(botResponse),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
                
            return res.status(200).json({ response: botResponse });
        }
        
        // Handle rejected applications
        else if (applicantStage === 'rejected' || applicantStage === 'P1 - FAILED') {
            botResponse = { 
                text: "Your application has been completed. Thank you for your interest in Prime Infrastructure. You may apply for other positions if available." 
            };
            
            // Save response to chat history
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(botResponse),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
                
            return res.status(200).json({ response: botResponse });
        }
        
        // Handle any other unrecognized input
        if (!botResponse) {
            botResponse = { 
                text: "I didn't understand that. Please try again or select from the available options." 
            };
            
            // Save fallback response to chat history
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(botResponse),
                    sender: 'bot',
                    timestamp,
                    applicantStage: req.session.applicantStage
                }]);
        }
        
        // Final response (this should rarely be reached now)
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

handleReuploadsFileUpload: async function(req, res) {
    console.log('📂 [Reupload] Initiating reupload file upload process...');

    try {
        const userId = req.session.userID;
        if (!userId) {
            console.error('❌ [Reupload] No user session found.');
            return res.status(400).json({ response: { text: 'User session not found.' } });
        }

        console.log('📂 [Reupload] Request body:', req.body);
        console.log('📂 [Reupload] Request files:', req.files ? Object.keys(req.files) : 'No files');

        if (!req.files || !req.files.file) {
            console.log('❌ [Reupload] No file uploaded.');
            return res.status(400).json({ response: { text: 'No file uploaded.' } });
        }

        const file = req.files.file;
        // 🔥 CRITICAL FIX: Better document type handling with debugging
        let docType = req.body.docType || 'additional';
        
        // Normalize the document type
        switch(docType.toLowerCase()) {
            case 'degree':
            case 'degree_certificate':
            case 'degree certificate':
                docType = 'degree';
                break;
            case 'certification':
            case 'cert':
            case 'certificate':
                docType = 'certification';
                break;
            case 'resume':
            case 'cv':
                docType = 'resume';
                break;
            case 'additional':
            case 'additional_document':
            case 'additional document':
            case 'addtl':
                docType = 'additional';
                break;
            default:
                console.log('⚠️ [Reupload] Unknown document type, defaulting to additional:', docType);
                docType = 'additional';
        }
        
        console.log(`📎 [Reupload] File received: ${file.name} for ${docType} (Type: ${file.mimetype}, Size: ${file.size} bytes)`);

        // File validation
        const allowedTypes = [
            'application/pdf', 'image/jpeg', 'image/png', 'image/jpg',
            'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        const maxSize = 5 * 1024 * 1024; // 5 MB
        
        if (!allowedTypes.includes(file.mimetype)) {
            console.log('❌ [Reupload] Invalid file type:', file.mimetype);
            return res.status(400).json({ response: { text: 'Invalid file type. Please upload PDF, DOC, DOCX, or image files.' } });
        }
        
        if (file.size > maxSize) {
            console.log('❌ [Reupload] File size exceeds the 5 MB limit:', file.size);
            return res.status(400).json({ response: { text: 'File size exceeds the 5 MB limit.' } });
        }

        // Check if this is actually a reupload request
        const { data: applicantData, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select('applicantStatus')
            .eq('userId', userId)
            .single();
        
        if (applicantError || !applicantData) {
            console.error('❌ [Reupload] Error checking applicant status:', applicantError);
            return res.status(400).json({ response: { text: 'Error checking applicant status' } });
        }
        
        console.log('📂 [Reupload] Current applicant status:', applicantData.applicantStatus);
        
        const isReuploadRequest = applicantData.applicantStatus.includes('Requested for Reupload');
        if (!isReuploadRequest) {
            console.log('❌ [Reupload] Not a valid reupload request. Status:', applicantData.applicantStatus);
            return res.status(400).json({ response: { text: 'This is not a valid reupload request.' } });
        }

        // Get current reupload data
        const { data: assessmentData, error: assessmentError } = await supabase
            .from('applicant_initialscreening_assessment')
            .select('hrVerification')
            .eq('userId', userId)
            .single();
        
        if (assessmentError) {
            console.error('❌ [Reupload] Error getting assessment data:', assessmentError);
            return res.status(400).json({ response: { text: 'Error retrieving reupload instructions' } });
        }
        
        console.log('📂 [Reupload] Raw HR verification data:', assessmentData.hrVerification);
        
        let reuploadData;
        try {
            reuploadData = JSON.parse(assessmentData.hrVerification);
        } catch (e) {
            console.log('📂 [Reupload] Failed to parse JSON, using fallback format');
            // Fallback for old format
            reuploadData = {
                documentsRequested: ['additional'],
                remarks: assessmentData.hrVerification
            };
        }
        
        console.log('📂 [Reupload] Parsed reupload data:', reuploadData);
        console.log('📂 [Reupload] Document type to upload:', docType);
        console.log('📂 [Reupload] Requested documents:', reuploadData.documentsRequested);

        // Verify that this document type was actually requested
        if (!reuploadData.documentsRequested.includes(docType)) {
            console.log('❌ [Reupload] Document type not in requested list.');
            console.log('📂 [Reupload] Requested:', reuploadData.documentsRequested);
            console.log('📂 [Reupload] Attempting to upload:', docType);
            return res.status(400).json({ 
                response: { 
                    text: `The document type "${docType}" was not requested for reupload. Please upload only the requested documents: ${reuploadData.documentsRequested.join(', ')}.` 
                } 
            });
        }

        // Generate unique file name
        const timestamp = Date.now();
        const fileExtension = file.name.split('.').pop();
        const uniqueName = `${timestamp}-${docType}-reupload.${fileExtension}`;
        
        console.log('📂 [Reupload] Generated filename:', uniqueName);

        // Upload directly to Supabase (skip local file handling to avoid permission issues)
        console.log('📂 [Reupload] Uploading directly to Supabase...');
        
        const { error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(uniqueName, file.data, {
                contentType: file.mimetype,
                cacheControl: '3600',
                upsert: false,
            });

        if (uploadError) {
            console.error('❌ [Reupload] Error uploading file to Supabase:', uploadError);
            return res.status(500).json({ response: { text: `Error uploading file to Supabase: ${uploadError.message}` } });
        }

        const fileUrl = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${uniqueName}`;
        console.log(`✅ [Reupload] File uploaded successfully: ${fileUrl}`);

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
            console.error('❌ [Reupload] Error inserting file metadata:', insertError);
            // Don't fail the upload for metadata insertion error, just log it
        }

        console.log('✅ [Reupload] File metadata inserted into database.');

        // 🔥 CRITICAL: Update the correct field based on document type with detailed logging
        let updateField = {};
        let successMessage = '';
        
        switch(docType) {
            case 'degree':
                updateField = { degree_url: fileUrl };
                successMessage = '✅ Degree certificate uploaded successfully.';
                console.log('📂 [Reupload] Updating degree_url field');
                break;
            case 'certification':
                updateField = { cert_url: fileUrl };
                successMessage = '✅ Certification document uploaded successfully.';
                console.log('📂 [Reupload] Updating cert_url field');
                break;
            case 'resume':
                updateField = { resume_url: fileUrl };
                successMessage = '✅ Resume uploaded successfully.';
                console.log('📂 [Reupload] Updating resume_url field');
                break;
            case 'additional':
                updateField = { addtlfile_url: fileUrl };
                successMessage = '✅ Additional document uploaded successfully.';
                console.log('📂 [Reupload] Updating addtlfile_url field');
                break;
            default:
                console.error('❌ [Reupload] Unknown document type for field mapping:', docType);
                updateField = { addtlfile_url: fileUrl };
                successMessage = '✅ Document uploaded successfully.';
        }
        
        console.log('📂 [Reupload] Update field object:', updateField);
        
        // Update the file URL in the assessment table
        const { error: updateError } = await supabase
            .from('applicant_initialscreening_assessment')
            .update(updateField)
            .eq('userId', userId);
        
        if (updateError) {
            console.error('❌ [Reupload] Error updating document in database:', updateError);
            return res.status(400).json({ response: { text: `Error updating document in database: ${updateError.message}` } });
        }
        
        console.log('✅ [Reupload] Database updated successfully');
        
        // Track uploaded documents
        if (!req.session.uploadedDocuments) {
            req.session.uploadedDocuments = [];
        }
        
        if (!req.session.uploadedDocuments.includes(docType)) {
            req.session.uploadedDocuments.push(docType);
        }
        
        console.log('📂 [Reupload] Uploaded documents so far:', req.session.uploadedDocuments);
        console.log('📂 [Reupload] Total requested documents:', reuploadData.documentsRequested);
        
        // Check if all requested documents have been uploaded
        const allUploaded = reuploadData.documentsRequested.every(doc => 
            req.session.uploadedDocuments.includes(doc)
        );
        
        let nextMessage = null;
        
        if (allUploaded) {
            console.log('✅ [Reupload] All requested documents have been uploaded!');
            
            // Update applicant status back to normal P1 awaiting
            const { error: statusUpdateError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: "P1 - Awaiting for HR Action" })
                .eq('userId', userId);
            
            if (statusUpdateError) {
                console.error('❌ [Reupload] Error updating status:', statusUpdateError);
            } else {
                console.log('✅ [Reupload] Applicant status updated back to P1 - Awaiting for HR Action');
            }
            
            // Clear HR verification since all documents have been reuploaded
            await supabase
                .from('applicant_initialscreening_assessment')
                .update({ hrVerification: null })
                .eq('userId', userId);
            
            // Clear session data
            delete req.session.uploadedDocuments;
            delete req.session.reuploadData;
            
            nextMessage = {
                text: "Thank you for uploading all requested documents. Your application has been submitted and is now awaiting review by our HR team. You will be notified once a decision has been made."
            };
        } else {
            const remainingDocs = reuploadData.documentsRequested.filter(doc => 
                !req.session.uploadedDocuments.includes(doc)
            );
            
            const remainingDocNames = remainingDocs.map(doc => {
                switch(doc) {
                    case 'degree': return 'Degree Certificate';
                    case 'certification': return 'Certification Document';
                    case 'resume': return 'Resume';
                    case 'additional': return 'Additional Document';
                    default: return doc;
                }
            });
            
            nextMessage = {
                text: `Please upload the remaining document(s): ${remainingDocNames.join(', ')}.`,
                buttons: remainingDocs.map(docType => ({
                    text: `Upload ${remainingDocNames[remainingDocs.indexOf(docType)]}`,
                    type: 'file_upload_reupload',
                    docType: docType
                }))
            };
        }
        
        // Save messages to chat history
        const timestamp2 = new Date().toISOString();
        const messagesToSave = [{
            userId,
            message: JSON.stringify({ text: successMessage }),
            sender: 'bot',
            timestamp: timestamp2,
            applicantStage: allUploaded ? "P1 - Awaiting for HR Action" : req.session.applicantStage
        }];
        
        if (nextMessage) {
            messagesToSave.push({
                userId,
                message: JSON.stringify(nextMessage),
                sender: 'bot',
                timestamp: new Date(Date.now() + 1000).toISOString(),
                applicantStage: allUploaded ? "P1 - Awaiting for HR Action" : req.session.applicantStage
            });
        }
        
        const { error: chatSaveError } = await supabase
            .from('chatbot_history')
            .insert(messagesToSave);
            
        if (chatSaveError) {
            console.error('❌ [Reupload] Error saving chat messages:', chatSaveError);
        }
        
        console.log('✅ [Reupload] Process completed successfully');
        
        // Return response
        const response = {
            text: successMessage,
            applicantStage: allUploaded ? "P1 - Awaiting for HR Action" : req.session.applicantStage,
            uploadComplete: allUploaded
        };
        
        if (nextMessage) {
            response.nextMessage = nextMessage;
        }
        
        return res.status(200).json({ response });
        
    } catch (error) {
        console.error('❌ [Reupload] Unexpected error:', error);
        console.error('❌ [Reupload] Error stack:', error.stack);
        return res.status(500).json({ response: { text: `An unexpected error occurred during reupload: ${error.message}` } });
    }
},

handleReuploadScenario: async function(req, res, userId, file) {
    try {
        console.log('📂 [Reupload] Handling reupload scenario for userId:', userId);
        
        // Get HR verification to understand what was requested
        const { data: assessmentData, error: assessmentError } = await supabase
            .from('applicant_initialscreening_assessment')
            .select('hrVerification')
            .eq('userId', userId)
            .single();
        
        if (assessmentError) {
            console.error('❌ [Reupload] Error getting assessment data:', assessmentError);
            return res.status(400).json({ response: "Error retrieving reupload instructions" });
        }
        
        const hrRemarks = assessmentData.hrVerification || '';
        console.log('📂 [Reupload] HR Remarks:', hrRemarks);
        
        // Upload the file to Supabase storage
        const fileUrl = await this.uploadFileToSupabase(file, 'reupload');
        
        if (!fileUrl) {
            return res.status(400).json({ response: "Error uploading file to storage" });
        }
        
        console.log('✅ [Reupload] File uploaded successfully:', fileUrl);
        
        // Determine which field to update based on HR remarks
        let updateField = {};
        let successMessage = '';
        
        const remarksLower = hrRemarks.toLowerCase();
        
        if (remarksLower.includes('degree')) {
            updateField = { degree_url: fileUrl };
            successMessage = '✅ Degree document uploaded successfully.';
            console.log('📂 [Reupload] Updating degree_url field');
        } else if (remarksLower.includes('certification') || remarksLower.includes('certificate') || remarksLower.includes('cert')) {
            updateField = { cert_url: fileUrl };
            successMessage = '✅ Certification document uploaded successfully.';
            console.log('📂 [Reupload] Updating cert_url field');
        } else if (remarksLower.includes('resume')) {
            updateField = { resume_url: fileUrl };
            successMessage = '✅ Resume uploaded successfully.';
            console.log('📂 [Reupload] Updating resume_url field');
        } else if (remarksLower.includes('additional') || remarksLower.includes('work permit') || remarksLower.includes('visa') || remarksLower.includes('addtl')) {
            updateField = { addtlfile_url: fileUrl };
            successMessage = '✅ Additional document uploaded successfully.';
            console.log('📂 [Reupload] Updating addtlfile_url field');
        } else {
            // Default to additional document if unclear
            updateField = { addtlfile_url: fileUrl };
            successMessage = '✅ Document uploaded successfully.';
            console.log('📂 [Reupload] Defaulting to addtlfile_url field');
        }
        
        console.log('📂 [Reupload] Updating field:', updateField);
        
        // Update the file URL in the database
        const { error: updateError } = await supabase
            .from('applicant_initialscreening_assessment')
            .update(updateField)
            .eq('userId', userId);
        
        if (updateError) {
            console.error('❌ [Reupload] Error updating document:', updateError);
            return res.status(400).json({ response: "Error updating document in database" });
        }
        
        // Also save to user_files table for tracking
        await this.saveFileMetadata(userId, file.name, fileUrl, file.size);
        
        // Update applicant status back to normal P1 awaiting (so HR can make final decision)
        const { error: statusUpdateError } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: "P1 - Awaiting for HR Action" })
            .eq('userId', userId);
        
        if (statusUpdateError) {
            console.error('❌ [Reupload] Error updating status:', statusUpdateError);
        }
        
        // Clear HR verification since document has been reuploaded
        await supabase
            .from('applicant_initialscreening_assessment')
            .update({ hrVerification: null })
            .eq('userId', userId);
        
        // Final completion message
        const finalMessage = "Thank you for uploading your document. Your application has been submitted and is now awaiting review by our HR team. You will be notified once a decision has been made.";
        
        console.log('✅ [Reupload] Process completed successfully');
        
        return res.status(200).json({
            response: {
                text: successMessage,
                nextMessage: {
                    text: finalMessage
                },
                applicantStage: "P1 - Awaiting for HR Action"
            }
        });
        
    } catch (error) {
        console.error('❌ [Reupload] Error in handleReuploadScenario:', error);
        return res.status(500).json({ response: "Error processing document reupload" });
    }
},

handleNormalUpload: async function(req, res, userId, file) {
    try {
        console.log('📂 [Normal Upload] Handling normal upload scenario for userId:', userId);
        
        // Check what stage the user is in
        const awaitingFileUpload = req.session.awaitingFileUpload;
        console.log('📂 [Normal Upload] Awaiting file upload type:', awaitingFileUpload);
        
        // Upload the file to Supabase storage
        const fileUrl = await this.uploadFileToSupabase(file, awaitingFileUpload || 'resume');
        
        if (!fileUrl) {
            return res.status(400).json({ response: "Error uploading file to storage" });
        }
        
        console.log(`✅ [Normal Upload] File uploaded: ${fileUrl}`);
        
        // Save to user_files table
        await this.saveFileMetadata(userId, file.name, fileUrl, file.size);
        
        let updateField = {};
        let successMessage = '';
        
        // Determine which field to update based on the upload type
        if (awaitingFileUpload === 'degree') {
            updateField = { degree_url: fileUrl };
            successMessage = '✅ Degree uploaded successfully. Let\'s continue.';
        } else if (awaitingFileUpload === 'certification') {
            updateField = { cert_url: fileUrl };
            successMessage = '✅ Certification uploaded successfully. Let\'s continue.';
        } else {
            // Default to resume
            updateField = { resume_url: fileUrl };
            successMessage = '✅ Resume uploaded successfully. Thank you for answering, this marks the end of the initial screening process. We have forwarded your resume to the HR department, and we will notify you once a decision has been made.';
            
            // Update applicant status for resume upload
            await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - Awaiting for HR Action' })
                .eq('userId', userId);
        }
        
        // Update the assessment table
        const { error: updateError } = await supabase
            .from('applicant_initialscreening_assessment')
            .update(updateField)
            .eq('userId', userId);
        
        if (updateError) {
            console.error('❌ [Normal Upload] Error updating assessment:', updateError);
            return res.status(400).json({ response: "Error updating document in database" });
        }
        
        console.log('✅ [Normal Upload] Process completed successfully');
        
        return res.status(200).json({
            response: {
                text: successMessage,
                applicantStage: awaitingFileUpload === 'resume' ? "P1 - Awaiting for HR Action" : req.session.applicantStage
            }
        });
        
    } catch (error) {
        console.error('❌ [Normal Upload] Error in handleNormalUpload:', error);
        return res.status(500).json({ response: "Error processing file upload" });
    }
},

// Helper function to upload file to Supabase storage
uploadFileToSupabase: async function(file, uploadType) {
    try {
        // Generate unique filename
        const timestamp = Date.now();
        const fileExtension = file.name.split('.').pop();
        const fileName = `${timestamp}-${uploadType}.${fileExtension}`;
        
        console.log('📂 [Supabase Upload] Uploading file:', fileName);
        
        // Upload to Supabase storage
        const { data, error } = await supabase.storage
            .from('uploads')
            .upload(fileName, file.data, {
                contentType: file.mimetype,
                upsert: false
            });
        
        if (error) {
            console.error('❌ [Supabase Upload] Upload error:', error);
            return null;
        }
        
        // Get public URL
        const { data: publicUrlData } = supabase.storage
            .from('uploads')
            .getPublicUrl(fileName);
        
        const fileUrl = publicUrlData.publicUrl;
        console.log('✅ [Supabase Upload] File uploaded successfully:', fileUrl);
        
        return fileUrl;
        
    } catch (error) {
        console.error('❌ [Supabase Upload] Error:', error);
        return null;
    }
},

// Helper function to save file metadata
saveFileMetadata: async function(userId, fileName, fileUrl, fileSize) {
    try {
        const { error } = await supabase
            .from('user_files')
            .insert([{
                userId: userId,
                file_name: fileName,
                file_url: fileUrl,
                file_size: fileSize,
                uploaded_at: new Date().toISOString()
            }]);
        
        if (error) {
            console.error('❌ [File Metadata] Error saving metadata:', error);
        } else {
            console.log('✅ [File Metadata] File metadata saved successfully');
        }
    } catch (error) {
        console.error('❌ [File Metadata] Unexpected error:', error);
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

    // Update your saveScreeningScores function to handle automatic rejections

saveScreeningScores: async function(userId, selectedPosition, screeningScores, resumeUrl = null) {
    try {
        console.log('💾 [Save Scores] Saving screening scores for user:', userId);
        console.log('💾 [Save Scores] Scores:', screeningScores);
        
        // Calculate scores by category
        let degreeScore = 0, experienceScore = 0, certificationScore = 0;
        let hardSkillsScore = 0, softSkillsScore = 0;
        let workSetupScore = false, availabilityScore = false;
        
        // Check for automatic rejection conditions
        let automaticRejection = false;
        let rejectionReason = '';
        
        screeningScores.forEach(score => {
            switch(score.type) {
                case 'degree':
                    degreeScore += score.answer;
                    break;
                case 'experience':
                    experienceScore += score.answer;
                    break;
                case 'certification':
                    certificationScore += score.answer;
                    break;
                case 'hardSkill':
                    hardSkillsScore += score.answer;
                    break;
                case 'softSkill':
                    softSkillsScore += score.answer;
                    break;
                case 'work_setup':
                    workSetupScore = score.answer === 1;
                    if (score.answer === 0) {
                        automaticRejection = true;
                        rejectionReason = 'work_setup';
                    }
                    break;
                case 'availability':
                    availabilityScore = score.answer === 1;
                    if (score.answer === 0) {
                        automaticRejection = true;
                        rejectionReason = 'availability';
                    }
                    break;
            }
        });
        
        console.log('💾 [Save Scores] Calculated scores:', {
            degreeScore, experienceScore, certificationScore,
            hardSkillsScore, softSkillsScore, workSetupScore, availabilityScore
        });
        
        if (automaticRejection) {
            console.log(`❌ [Save Scores] Automatic rejection detected: ${rejectionReason}`);
        }

        // Get job details for the selected position
        const jobDetails = await applicantController.getJobDetailsbyTitle(selectedPosition);
        if (!jobDetails) {
            throw new Error('Job details not found');
        }

        const jobId = jobDetails.jobId;
        console.log('💾 [Save Scores] Job ID:', jobId);

        // Prepare the data to save/update
        const assessmentData = {
            userId: userId,
            jobId: jobId,
            degreeScore: degreeScore,
            experienceScore: experienceScore,
            certificationScore: certificationScore,
            hardSkillsScore: hardSkillsScore,
            softSkillsScore: softSkillsScore,
            workSetupScore: workSetupScore,
            availabilityScore: availabilityScore,
            currentQuestionIndex: screeningScores.length,
            resume_url: resumeUrl,
            created_at: new Date().toISOString(),
            // 🔥 NEW: Add rejection tracking
            isRejected: automaticRejection,
            rejectionReason: automaticRejection ? rejectionReason : null
        };

        // Check if record already exists
        const { data: existingRecord, error: checkError } = await supabase
            .from('applicant_initialscreening_assessment')
            .select('*')
            .eq('userId', userId)
            .single();

        let result;
        if (existingRecord) {
            // Update existing record
            const { data, error } = await supabase
                .from('applicant_initialscreening_assessment')
                .update(assessmentData)
                .eq('userId', userId);
            result = { data, error };
        } else {
            // Insert new record
            const { data, error } = await supabase
                .from('applicant_initialscreening_assessment')
                .insert([assessmentData]);
            result = { data, error };
        }

        if (result.error) {
            console.error('❌ [Save Scores] Error saving assessment:', result.error);
            throw result.error;
        }

        console.log('✅ [Save Scores] Assessment saved successfully');

        // 🔥 CRITICAL: Handle automatic rejections
        if (automaticRejection) {
            console.log('❌ [Save Scores] Processing automatic rejection');
            
            // Update applicant status to P1 - FAILED
            const { error: statusError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - FAILED' })
                .eq('userId', userId);
            
            if (statusError) {
                console.error('❌ [Save Scores] Error updating status for rejection:', statusError);
            } else {
                console.log('✅ [Save Scores] Applicant status updated to P1 - FAILED for automatic rejection');
            }
            
            return {
                success: true,
                message: "We regret to inform you that you have not met the requirements for this position. Thank you for your interest in applying at Prime Infrastructure, and we wish you the best in your future endeavors.",
                isRejected: true,
                rejectionReason: rejectionReason
            };
        }

        // Calculate total score for non-rejected applications
        const totalQuestions = screeningScores.length;
        const totalScore = degreeScore + experienceScore + certificationScore + hardSkillsScore + softSkillsScore + (workSetupScore ? 1 : 0) + (availabilityScore ? 1 : 0);
        const percentage = totalQuestions > 0 ? (totalScore / totalQuestions) * 100 : 0;

        console.log('💾 [Save Scores] Total score calculation:', {
            totalScore, totalQuestions, percentage
        });

        // Determine if the applicant passes the initial screening
        const passingThreshold = 70; // You can adjust this threshold
        const passes = percentage >= passingThreshold;

        let message;
        if (passes) {
            message = `Congratulations! You have completed the initial screening with a score of ${percentage.toFixed(1)}%. Please proceed to upload your resume.`;
        } else {
            message = `Thank you for completing the screening. Unfortunately, you did not meet the minimum requirements for this position. Your score was ${percentage.toFixed(1)}%.`;
            
            // Update status to P1 - FAILED for low scores
            await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - FAILED' })
                .eq('userId', userId);
        }

        return {
            success: true,
            message: message,
            score: percentage,
            passes: passes,
            isRejected: !passes,
            rejectionReason: !passes ? 'low_score' : null
        };

    } catch (error) {
        console.error('❌ [Save Scores] Error in saveScreeningScores:', error);
        return {
            success: false,
            message: "There was an error processing your screening results. Please try again later.",
            error: error.message
        };
    }
},
    handleFileUpload: async function(req, res) {
    console.log('📂 [Upload] Initiating file upload process...');

    try {
        const userId = req.session.userID;
        if (!userId) {
            console.error('❌ [Upload] No user session found.');
            return res.status(400).json({ response: { text: 'User session not found.' } });
        }

        if (!req.files || !req.files.file) {
            console.log('❌ [Upload] No file uploaded.');
            return res.status(400).json({ response: { text: 'No file uploaded.' } });
        }

        const file = req.files.file;
        console.log(`📎 [Upload] File received: ${file.name} (Type: ${file.mimetype}, Size: ${file.size} bytes)`);

        // File validation
        const allowedTypes = [
            'application/pdf', 'image/jpeg', 'image/png', 'image/jpg',
            'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        const maxSize = 5 * 1024 * 1024; // 5 MB
        
        if (!allowedTypes.includes(file.mimetype)) {
            console.log('❌ [Upload] Invalid file type.');
            return res.status(400).json({ response: { text: 'Invalid file type. Please upload PDF, DOC, DOCX, or image files.' } });
        }
        
        if (file.size > maxSize) {
            console.log('❌ [Upload] File size exceeds the 5 MB limit.');
            return res.status(400).json({ response: { text: 'File size exceeds the 5 MB limit.' } });
        }

        // Check what type of file upload this is
        const awaitingFileUpload = req.session.awaitingFileUpload;
        console.log('📂 [Upload] Upload type:', awaitingFileUpload);

        // Generate unique file name
        const uniqueName = `${Date.now()}-${file.name}`;
        const filePath = path.join(__dirname, '../uploads', uniqueName);

        // Ensure uploads directory exists
        if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
            fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
        }

        // Save file locally first
        await file.mv(filePath);
        console.log('📂 [Upload] File successfully saved locally. Uploading to Supabase...');

        // Upload to Supabase
        const { error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(uniqueName, fs.readFileSync(filePath), {
                contentType: file.mimetype,
                cacheControl: '3600',
                upsert: false,
            });

        // Clean up local file
        fs.unlinkSync(filePath);
        console.log('📂 [Upload] Local file deleted after upload to Supabase.');

        if (uploadError) {
            console.error('❌ [Upload] Error uploading file to Supabase:', uploadError);
            return res.status(500).json({ response: { text: 'Error uploading file to Supabase.' } });
        }

        const fileUrl = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${uniqueName}`;
        console.log(`✅ [Upload] File uploaded successfully: ${fileUrl}`);

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
            console.error('❌ [Upload] Error inserting file metadata:', insertError);
            return res.status(500).json({ response: { text: 'Error inserting file metadata into database.' } });
        }

        console.log('✅ [Upload] File metadata successfully inserted into database.');

        let updateField = {};
        let successMessage = '';
        
        // Handle different upload types
        if (awaitingFileUpload === 'degree') {
            updateField = { degree_url: fileUrl };
            successMessage = '✅ Degree uploaded successfully. Let\'s continue.';
            req.session.degreeUrl = fileUrl;
            console.log('📂 [Upload] Updating degree_url field');
        } else if (awaitingFileUpload === 'certification') {
            updateField = { cert_url: fileUrl };
            successMessage = '✅ Certification uploaded successfully. Let\'s continue.';
            req.session.certificationUrl = fileUrl;
            console.log('📂 [Upload] Updating cert_url field');
        } else if (awaitingFileUpload === 'resume') {
            updateField = { resume_url: fileUrl };
            successMessage = '✅ Resume uploaded successfully. Thank you for answering, this marks the end of the initial screening process. We have forwarded your resume to the HR department, and we will notify you once a decision has been made.';
            req.session.resumeUrl = fileUrl;
            console.log('📂 [Upload] Updating resume_url field');
        } else {
            updateField = { addtlfile_url: fileUrl };
            successMessage = '✅ Document uploaded successfully.';
            console.log('📂 [Upload] Updating addtlfile_url field');
        }
        
        // Update the file URL in the assessment table
        const { error: updateError } = await supabase
            .from('applicant_initialscreening_assessment')
            .update(updateField)
            .eq('userId', userId);
        
        if (updateError) {
            console.error('❌ [Upload] Error updating document:', updateError);
            return res.status(400).json({ response: { text: 'Error updating document in database' } });
        }
        
        console.log('✅ [Upload] Database updated successfully');
        
        // Reset file upload flag
        delete req.session.awaitingFileUpload;
        
        let nextMessage = null;
        
        // 🔥 CRITICAL FIX: Handle continuation for degree/certification uploads
        if (awaitingFileUpload === 'degree' || awaitingFileUpload === 'certification') {
            console.log('🔄 [Upload] Continuing with next screening question...');
            
            // Change stage back to screening_questions
            req.session.applicantStage = 'screening_questions';
            
            // Increment question index
            req.session.currentQuestionIndex++;
            console.log(`➡️ [Upload] Next Question Index: ${req.session.currentQuestionIndex}`);
            
            // Check if there are more questions
            if (req.session.screeningQuestions && 
                req.session.currentQuestionIndex < req.session.screeningQuestions.length) {
                
                const nextQuestion = req.session.screeningQuestions[req.session.currentQuestionIndex];
                nextMessage = {
                    text: nextQuestion.text,
                    buttons: [
                        { text: 'Yes', value: 1 },
                        { text: 'No', value: 0 }
                    ]
                };
                
                console.log('✅ [Upload] Next question prepared:', nextQuestion.text);
            } else {
                // All questions completed, proceed to resume upload
                nextMessage = {
                    text: "All screening questions have been completed. Please upload your resume.",
                    buttons: [{ text: 'Upload Resume', type: 'file_upload' }]
                };
                
                req.session.applicantStage = 'resume_upload';
                req.session.awaitingFileUpload = 'resume';
                
                console.log('✅ [Upload] All questions completed, requesting resume upload');
            }
        } else if (awaitingFileUpload === 'resume') {
            // Update applicant status for resume upload
            const { error: statusUpdateError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - Awaiting for HR Action' })
                .eq('userId', userId);
            
            if (statusUpdateError) {
                console.error('❌ [Upload] Error updating applicant status:', statusUpdateError);
            } else {
                req.session.applicantStage = 'P1 - Awaiting for HR Action';
                console.log('✅ [Upload] Applicant status updated to P1 - Awaiting for HR Action');
            }
        }
        
        // Save the success message to chat history
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
        
        // Save the next message to chat history if it exists
        if (nextMessage) {
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify(nextMessage),
                    sender: 'bot',
                    timestamp: new Date(Date.now() + 1000).toISOString(), // 1 second delay
                    applicantStage: req.session.applicantStage
                }]);
        }
        
        console.log('✅ [Upload] Process completed successfully');
        
        // Return response with nextMessage if available
        const response = {
            text: successMessage,
            applicantStage: req.session.applicantStage
        };
        
        if (nextMessage) {
            response.nextMessage = nextMessage;
        }
        
        return res.status(200).json({ response });
        
    } catch (error) {
        console.error('❌ [Upload] Unexpected error:', error);
        return res.status(500).json({ response: { text: 'An unexpected error occurred during upload.' } });
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

// The getJobOffer function (shows the initial job offer page)
// The getJobOffer function (shows the initial job offer page)
getJobOffer: async function(req, res) {
    try {
        if (!req.session.userID) { // Using userID to match your existing code
            console.log('❌ [getJobOffer] No user session found. Redirecting to login...');
            return res.redirect('/applicant/login');
        }
        
        const userId = req.session.userID;
        console.log(`✅ [getJobOffer] Processing job offer for user ID: ${userId}`);
        
        // Get the applicant information
        const { data: applicantData, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select(`
                applicantId,
                jobId,
                applicantStatus
            `)
            .eq('userId', userId)
            .single();
        
        if (applicantError || !applicantData) {
            console.error('❌ [getJobOffer] Error fetching applicant data:', applicantError);
            return res.status(400).send('Unable to retrieve your application information.');
        }
        
        console.log(`✅ [getJobOffer] Applicant status: ${applicantData.applicantStatus}`);
        
        // For testing purposes, you might want to temporarily disable this check
        // Comment this block if you want to see the page regardless of status
        if (applicantData.applicantStatus !== 'P3 - PASSED - Job Offer Sent') {
            console.log(`❌ [getJobOffer] Applicant status does not qualify for job offer: ${applicantData.applicantStatus}`);
            return res.send('No job offer is currently available for you. Current status: ' + applicantData.applicantStatus);
        }
        
        // Get job position details
        const { data: jobData, error: jobError } = await supabase
            .from('jobpositions')
            .select('jobTitle')
            .eq('jobId', applicantData.jobId)
            .single();
        
        if (jobError) {
            console.error('❌ [getJobOffer] Error fetching job data:', jobError);
            return res.status(400).send('Unable to retrieve job information.');
        }
        
        // Get the start date from onboarding_position-startdate table
        let startDate;
        try {
            const { data: startDateData, error: startDateError } = await supabase
                .from('onboarding_position-startdate')
                .select('setStartDate')
                .eq('jobId', applicantData.jobId)
                .single();
            
            if (startDateError) {
                console.log('❌ [getJobOffer] Error fetching start date:', startDateError);
                // Fallback to default start date (2 weeks from now)
                startDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                console.log(`✅ [getJobOffer] Using default start date: ${startDate}`);
            } else if (startDateData && startDateData.setStartDate) {
                startDate = startDateData.setStartDate;
                console.log(`✅ [getJobOffer] Using database start date: ${startDate}`);
            } else {
                // Default to 2 weeks from now if no data found
                startDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                console.log(`✅ [getJobOffer] Using default start date: ${startDate}`);
            }
        } catch (error) {
            console.error('❌ [getJobOffer] Unexpected error fetching start date:', error);
            // Default to 2 weeks from now
            startDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            console.log(`✅ [getJobOffer] Using default start date after error: ${startDate}`);
        }
        
        // Prepare data for the template
        const templateData = {
            jobTitle: jobData.jobTitle,
            startDate: startDate,
            applicantId: applicantData.applicantId
        };
        
        console.log('✅ [getJobOffer] Rendering job offer page with data:', templateData);
        
        // Render the job offer page
        res.render('applicant_pages/joboffer', templateData);
        
    } catch (error) {
        console.error('❌ [getJobOffer] Error displaying job offer:', error);
        res.status(500).send('Something went wrong while processing your job offer. Please try again later.');
    }
},

// API endpoint to accept job offer
// API endpoint to accept job offer
// API endpoint to accept job offer
acceptJobOffer: async function(req, res) {
    try {
        console.log('✅ [acceptJobOffer] Processing job offer acceptance request');
        
        const { applicantId } = req.body;
        
        if (!applicantId) {
            console.log('❌ [acceptJobOffer] Missing applicant ID in request');
            return res.status(400).json({ success: false, message: 'Missing applicant ID' });
        }
        
        console.log(`✅ [acceptJobOffer] Accepting job offer for applicant ID: ${applicantId}`);
        
        // Get userId and jobId from applicant record
        const { data: applicantData, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select('userId, jobId, applicantStatus')
            .eq('applicantId', applicantId)
            .single();
            
        if (applicantError || !applicantData) {
            console.error('❌ [acceptJobOffer] Error fetching applicant data:', applicantError);
            return res.status(500).json({ success: false, message: 'Failed to fetch applicant data' });
        }
        
        const userId = applicantData.userId;
        const jobId = applicantData.jobId;
        
        console.log(`✅ [acceptJobOffer] User ID: ${userId}, Job ID: ${jobId}`);
        
        // Update the isAccepted field in onboarding_position-startdate table
        try {
            const { error: startDateError } = await supabase
                .from('onboarding_position-startdate')
                .update({ isAccepted: true })
                .eq('jobId', jobId);
                
            if (startDateError) {
                console.error('❌ [acceptJobOffer] Error updating job acceptance status:', startDateError);
                // Continue with the process even if this fails - it might be a new record or table structure issue
            } else {
                console.log('✅ [acceptJobOffer] Updated job acceptance status in onboarding_position-startdate table');
            }
        } catch (startDateErr) {
            console.error('❌ [acceptJobOffer] Unexpected error updating start date acceptance:', startDateErr);
            // Continue with the process even if this part fails
        }
        
        // Update the applicant status - Use "Onboarding - First Day Checklist Sent" instead of "Job Offer Accepted"
        const { error: updateError } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'Onboarding - First Day Checklist Sent' })
            .eq('applicantId', applicantId);
        
        if (updateError) {
            console.error('❌ [acceptJobOffer] Error updating applicant status:', updateError);
            return res.status(500).json({ success: false, message: 'Failed to update application status' });
        }
        
        console.log('✅ [acceptJobOffer] Successfully updated applicant status to "Onboarding - First Day Checklist Sent"');
        
        // Send a confirmation message through the chatbot
        try {
            const currentTime = new Date().toISOString();
            
            // Send a predefined message to the user's chatbot
            await supabase
                .from('chatbot_history')
                .insert([{
                    userId: userId,
                    message: JSON.stringify({
                        text: "Thank you for accepting our job offer! We're excited to have you join our team. Please complete your onboarding checklist to prepare for your first day."
                    }),
                    sender: 'bot',
                    timestamp: currentTime,
                    applicantStage: 'Onboarding - First Day Checklist Sent'
                }]);
            
            console.log('✅ [acceptJobOffer] Added confirmation message to chatbot history');
        } catch (chatError) {
            console.error('❌ [acceptJobOffer] Error sending confirmation message:', chatError);
            // Continue even if the message fails
        }
        
        return res.json({
            success: true,
            message: 'Job offer successfully accepted',
            redirectUrl: '/applicant/onboarding'  // Ensure this URL is correct
        });
        
    } catch (error) {
        console.error('❌ [acceptJobOffer] Error accepting job offer:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
},
// The onboarding page controller (shows the onboarding checklist after job offer acceptance)
// The onboarding page controller (shows the onboarding checklist after job offer acceptance)
getApplicantOnboarding: async function(req, res) {
    try {
        // IMPORTANT: Match the session variable name with what's used in other functions (userID not userId)
        if (!req.session.userID) {
            console.log('❌ [getApplicantOnboarding] No user session found. Redirecting to login...');
            return res.redirect('/applicant/login');
        }
        
        const userId = req.session.userID;
        console.log(`✅ [getApplicantOnboarding] Processing onboarding for user ID: ${userId}`);
        
        // Get applicant details including job ID
        const { data: applicantData, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select(`
                applicantId,
                firstName,
                lastName,
                jobId,
                userId,
                phoneNo,
                applicantStatus,
                departmentId
            `)
            .eq('userId', userId)
            .single();
        
        if (applicantError || !applicantData) {
            console.error('❌ [getApplicantOnboarding] Error fetching applicant data:', applicantError);
            return res.status(400).send('Unable to retrieve your application information.');
        }
        
        console.log(`✅ [getApplicantOnboarding] Applicant status: ${applicantData.applicantStatus}`);
        
        // Verify the applicant has the correct status (now using "Onboarding - First Day Checklist Sent")
        if (applicantData.applicantStatus !== 'Onboarding - First Day Checklist Sent') {
            console.log(`❌ [getApplicantOnboarding] Incorrect applicant status: ${applicantData.applicantStatus}`);
            return res.status(400).send('You need to accept a job offer before accessing onboarding. Current status: ' + applicantData.applicantStatus);
        }
        
        // Get job position details
        const { data: jobData, error: jobError } = await supabase
            .from('jobpositions')
            .select('jobTitle')
            .eq('jobId', applicantData.jobId)
            .single();
        
        if (jobError) {
            console.error('❌ [getApplicantOnboarding] Error fetching job data:', jobError);
            return res.status(400).send('Unable to retrieve job information.');
        }
        
        // Get department details
        const { data: deptData, error: deptError } = await supabase
            .from('departments')
            .select('deptName')
            .eq('departmentId', applicantData.departmentId)
            .single();
            
        const departmentName = deptData ? deptData.deptName : 'Unknown Department';
        
        // Get the start date from onboarding_position-startdate table
        let startDate;
        try {
            const { data: startDateData, error: startDateError } = await supabase
                .from('onboarding_position-startdate')
                .select('setStartDate, isAccepted')
                .eq('jobId', applicantData.jobId)
                .single();
            
            if (startDateError || !startDateData) {
                console.log('❌ [getApplicantOnboarding] Error fetching start date:', startDateError);
                // Fallback to default start date
                startDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            } else {
                startDate = startDateData.setStartDate;
            }
        } catch (error) {
            console.error('❌ [getApplicantOnboarding] Error with start date:', error);
            // Fallback to default
            startDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        
        // Get user email
        const { data: userData, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userId', userId)
            .single();
            
        const userEmail = userData ? userData.userEmail : null;
        
        // Format the applicant object for the template
        const applicant = {
            applicantId: applicantData.applicantId,
            fullName: `${applicantData.firstName} ${applicantData.lastName}`,
            firstName: applicantData.firstName,
            lastName: applicantData.lastName,
            phoneNo: applicantData.phoneNo,
            email: userEmail,
            jobTitle: jobData.jobTitle,
            department: departmentName,
            startDate: startDate
        };
        
        console.log('✅ [getApplicantOnboarding] Rendering onboarding page with data:', {
            applicantId: applicant.applicantId,
            name: applicant.fullName,
            jobTitle: applicant.jobTitle
        });
        
        // Render the onboarding page
        res.render('applicant_pages/onboarding', { applicant });
        
    } catch (error) {
        console.error('❌ [getApplicantOnboarding] Error displaying onboarding page:', error);
        res.status(500).send('Something went wrong while preparing your onboarding page.');
    }
},
updateApplicantStatus: async function(req, res) {
    try {
        // Verify user session
        if (!req.session.userID) {
            console.log('❌ [updateApplicantStatus] No user session found');
            return res.status(401).json({
                success: false,
                message: 'Authentication required. Please log in again.'
            });
        }
        
        const userId = req.session.userID;
        console.log(`✅ [updateApplicantStatus] Processing status update for user ID: ${userId}`);
        
        // Extract data from request body
        const { applicantId } = req.body;
        
        if (!applicantId) {
            console.log('❌ [updateApplicantStatus] Missing applicant ID');
            return res.status(400).json({
                success: false,
                message: 'Missing applicant ID'
            });
        }
        
        // Verify the applicant ID belongs to the logged-in user
        const { data: applicantData, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select('applicantId, applicantStatus')
            .eq('userId', userId)
            .eq('applicantId', applicantId)
            .single();
        
        if (applicantError || !applicantData) {
            console.error('❌ [updateApplicantStatus] Applicant verification failed:', applicantError);
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this status'
            });
        }
        
        // Update applicant status to "Onboarding - Checklist Accomplished"
        const { data: updateData, error: updateError } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'Onboarding - Checklist Accomplished' })
            .eq('applicantId', applicantId)
            .select();
        
        if (updateError) {
            console.error('❌ [updateApplicantStatus] Error updating applicant status:', updateError);
            return res.status(500).json({
                success: false,
                message: 'Status update failed'
            });
        }
        
        console.log(`✅ [updateApplicantStatus] Successfully updated status for applicant ID: ${applicantId}`);
        
        // Return success response
        return res.status(200).json({
            success: true,
            message: 'First day checklist successfully completed',
            newStatus: 'Onboarding - Checklist Accomplished'
        });
        
    } catch (error) {
        console.error('❌ [updateApplicantStatus] Unexpected error:', error);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred while processing your request'
        });
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