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
                        return res.redirect('/employeechatbothome'); // Redirect to employee chatbot
                    }
                } else {
                    console.log('Password mismatch for user:', email);
                    return res.render('applicant_pages/login', { message: 'Wrong password' });
                }
            }
    
            console.log('User  not found in useraccounts, checking staffaccounts...');
            let { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, userPass, userRole')
                .eq('userEmail', email);
    
            if (staffError) {
                console.error('Error querying staffaccounts:', staffError);
                return res.status(500).send('Internal Server Error');
            }
    
            console.log('Staff Data:', staffData);
    
            if (staffData.length > 0) {
                const passwordMatch = await bcrypt.compare(password, staffData[0].userPass);
    
                if (passwordMatch) {
                    req.session.authenticated = true;
                    req.session.userID = staffData[0].userId;
                    req.session.userRole = staffData[0].userRole;
    
                    console.log('Redirecting to employee chatbot...');
                    return res.redirect('/employeechatbothome'); 
                } else {
                    console.log('Password mismatch for staff user:', email);
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
    
    // Function to render chatbot page with the initial greeting
    getChatbotPage: async function (req, res) {
        try {
            const userId = req.session.userID;
            console.log('User  ID from session:', userId);
    
            if (!userId) {
                console.log('User  not authenticated, redirecting to login...');
                return res.redirect('/login');
            }
    
            let chatData = req.session?.chatHistory || []; // Retrieve from session
            console.log('Chat Data from session:', chatData);
            let initialResponse = "";
    
            if (chatData.length === 0 && userId) {
                // Fetch from database if session data is missing
                const { data: chatHistory, error } = await supabase
                    .from('chatbot_history')
                    .select('message, sender, timestamp')
                    .eq('userId', userId)
                    .order('timestamp', { ascending: true });
    
                if (!error && chatHistory.length > 0) {
                    chatData = chatHistory.map(chat => ({
                        message: chat.message,
                        sender: chat.sender,
                        timestamp: chat.timestamp,
                    }));
    
                    // Store it in session for next time
                    req.session.chatHistory = chatData;
                    console.log('Fetched Chat History from database:', chatData);
                } else {
                    console.error('Error fetching chat history from database:', error);
                }
            }
    
            if (chatData.length === 0) {
                // Default welcome message
                const initialMessage = "Hi! Welcome to Prime Infrastructure's recruitment portal. What position are you going to apply for?";
                console.log('No chat history found, setting initial message.');
    
                try {
                    const positions = await applicantController.getJobPositionsList();
                    initialResponse = `${initialMessage}\nHere are our current job openings:\n${positions.map(pos => `- ${pos}`).join('\n')}\nPlease select a position.`;
                    chatData.push({ message: initialResponse, sender: 'bot', timestamp: new Date().toISOString() });
                    console.log('Initial Response:', initialResponse);
                } catch (jobError) {
                    console.error("Error fetching job positions:", jobError);
                    initialResponse = initialMessage;
                    chatData.push({ message: initialMessage, sender: 'bot', timestamp: new Date().toISOString() });
                }
            }
    
            res.render('applicant_pages/chatbot', { chatData, initialResponse });  // Pass initialResponse here
        } catch (error) {
            console.error('Error rendering chatbot page:', error);
            res.status(500).send('Error loading chatbot page');
        }
    },
    
    handleChatbotMessage: async function (req, res) {
        try {
            console.log('Start processing chatbot message');
    
            const userId = req.session.userID;
            if (!userId) {
                return res.status(401).json({ response: "Unauthorized" });
            }
    
            const userMessage = req.body.message.toLowerCase();
            const timestamp = new Date().toISOString();
            console.log(`User ID: ${userId}, Message: ${userMessage}, Timestamp: ${timestamp}`);
    
            // Save user message in chatbot history
            await supabase
                .from('chatbot_history')
                .insert([{ userId, message: userMessage, sender: 'user', timestamp }]);
    
            // Fetch existing chat history
            const { data: chatHistory, error: chatHistoryError } = await supabase
                .from('chatbot_history')
                .select('*')
                .eq('userId', userId)
                .order('timestamp', { ascending: true });
    
            if (chatHistoryError) {
                console.error('Error fetching chat history:', chatHistoryError);
                return res.status(500).json({ response: "Error fetching chat history." });
            }
    
            // Determine the current stage based on chat history
            let botResponse;
            let applicantStage = req.session.applicantStage || 'initial';
    
            // Gracefully handle unknown messages without breaking
            if (!userMessage) {
                botResponse = "I didn't quite get that. Could you please rephrase or select from the options?";
            }
    
            // Handle stages flow
            if (applicantStage === 'initial') {
                const positions = await applicantController.getJobPositionsList();
                const selectedPosition = positions.find(position => userMessage.includes(position.toLowerCase()));
    
                if (selectedPosition) {
                    req.session.selectedPosition = selectedPosition;
                    const jobDetails = await applicantController.getJobDetails(selectedPosition);
    
                    if (jobDetails) {
                        const updateJobResult = await applicantController.updateApplicantJobAndDepartmentOnATS(
                            userId,
                            jobDetails.jobId,
                            jobDetails.departmentId
                        );
    
                        if (!updateJobResult.success) {
                            console.error(updateJobResult.message);
                            botResponse = "Error updating your application details. Please try again later.";
                            res.status(500).json({ response: botResponse });
                            return;
                        }
    
                        botResponse = {
                            text: `You have chosen *${selectedPosition}*. Here are the details:\n` +
                                `**Job Title:** ${jobDetails.jobTitle}\n` +
                                `**Description:** ${jobDetails.jobDescrpt}\n\n` +
                                `Would you like to proceed with your application?`,
                            buttons: [
                                { text: 'Yes', value: 1 },
                                { text: 'No', value: 0 }
                            ]
                        };
                        req.session.applicantStage = 'job_selection';
                    } else {
                        botResponse = "Sorry, I couldn't find the job details.";
                    }
                } else {
                    botResponse = "Please specify a job position from the available list.";
                }
    
            } else if (applicantStage === 'job_selection' && userMessage.includes('yes')) {
                const jobId = (await applicantController.getJobDetails(req.session.selectedPosition)).jobId;
                const result = await applicantController.updateApplicantStatusToP1Initial(userId);
    
                if (!result.success) {
                    console.error(result.message);
                    res.status(500).json({ response: result.message });
                    return;
                }
    
                // Retrieve screening questions
                if (!req.session.screeningQuestions) {
                    const questions = await applicantController.getInitialScreeningQuestions(jobId);
    
                    if (!questions || questions.length === 0) {
                        botResponse = "No screening questions available for this position.";
                        res.status(200).json({ response: botResponse });
                        return;
                    }
    
                    req.session.screeningQuestions = questions;
                    req.session.currentQuestionIndex = 0;
                    req.session.screeningScores = [];
                }
    
                const questions = req.session.screeningQuestions;
                const currentIndex = req.session.currentQuestionIndex || 0;
    
                // Ask the first question
                if (currentIndex < questions.length) {
                    botResponse = {
                        text: questions[currentIndex].text,
                        buttons: [
                            { text: 'Yes', value: 1 },
                            { text: 'No', value: 0 }
                        ]
                    };
                    req.session.currentQuestionIndex = currentIndex + 1;
                    req.session.applicantStage = 'screening_questions';
                } else {
                    botResponse = "All screening questions have been answered.";
                }
    
            } else if (applicantStage === 'screening_questions') {
                const questions = req.session.screeningQuestions;
                const currentIndex = req.session.currentQuestionIndex;
    
                if (currentIndex < questions.length) {
                    const currentQuestion = questions[currentIndex];
                    const answerValue = userMessage.trim().toLowerCase() === 'yes' ? 1 : 0;
    
                    req.session.screeningScores.push({ question: currentQuestion.text, answer: answerValue });
    
                    req.session.currentQuestionIndex++;
    
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
                        await applicantController.saveScreeningScores(userId, req.session.selectedPosition, req.session.screeningScores);
                        botResponse = {
                            text: "Thank you for answering the questions. Please upload your resume.",
                            buttons: [
                                { text: 'Upload File', type: 'file_upload', action: 'uploadResume' }
                            ]
                        };
    
                        req.session.applicantStage = 'file_upload';
                    }
                }
    
            } else if (req.body.file) {
                await this.handleFileUpload(req, res);
    
                const applicantRecord = await applicantController.getApplicantStatus(userId);
                if (applicantRecord && applicantRecord.applicantStatus === "P1 - PASSED") {
                    botResponse = {
                        messages: [
                            { text: "✅ Congratulations! You passed the initial screening." },
                            { text: "📅 Please schedule your interview now." },
                            { 
                                text: "Click the button below to schedule.",
                                buttons: [
                                    { text: "Schedule on Calendly", url: "/applicant/schedule-interview" }
                                ]
                            }
                        ]
                    };
                    req.session.applicantStage = 'interview_scheduling';
                } else {
                    botResponse = "Your application is under review.";
                }
    
            } else {
                // ✅ Handle unknown messages without breaking
                botResponse = {
                    text: "I didn't quite get that. Please try again or choose an option below.",
                    buttons: [
                        { text: 'See Job Openings', value: 'job_positions' },
                        { text: 'Check Application Status', value: 'application_status' }
                    ]
                };
            }
    
            // Save bot response
            await supabase
                .from('chatbot_history')
                .insert([{ 
                    userId, 
                    message: typeof botResponse === 'string' ? botResponse : JSON.stringify(botResponse), 
                    sender: 'bot', 
                    timestamp 
                }]);
    
            res.status(200).json({ response: botResponse, chatHistory });
    
        } catch (error) {
            console.error('Error handling chatbot message:', error);
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
                type: 'hardSkill', // Ensure this is set correctly
                text: `To assess your hard skills, do you have ${s.jobReqSkillName}?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            })),
            ...softSkills.map(s => ({
                type: 'softSkill', // Ensure this is set correctly
                text: `To assess your soft skills, do you have ${s.jobReqSkillName}?`,
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
    getCalendly: async function (req, res) {
        res.render('applicant_pages/calendly', { errors: {} })
    },

    getOnboarding: async function(req, res) {
        res.render('applicant_pages/onboarding', { errors: {} });

    },

    postOnboarding: async function (req, res) {
        try {
            console.log('Received data:', req.body); // Debugging
    
            const { checklist, signatures, managerVerified, notes } = req.body;
    
            // Validate required fields
            if (!managerVerified) {
                return res.status(400).json({ success: false, message: 'Manager verification required.' });
            }
    
            // Insert into the `onboarding` table
            const { data: onboardingData, error: onboardingError } = await supabase
                .from('onboarding')
                .insert([
                    {
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
    
            console.log('Inserted into onboarding_tasks table:', tasksDataResult); 
    
            res.json({ success: true, message: 'Checklist saved successfully!', onboardingId });
        } catch (error) {
            console.error('Error saving checklist:', error);
            res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
        }
    },

    // Function to fetch job details from the db
// Function to fetch detailed job information, including required certifications, degrees, experiences, and skills
getJobDetails: async function(jobTitle) {
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

        return jobDetails;
    } catch (error) {
        console.error('Server error:', error);
        return null;
    }
},

saveScreeningScores: async function (userId, jobId, responses, screeningCounters, resumeUrl) {
    try {
        console.log('Saving screening scores for user:', userId);
        
        // Log input parameters for debugging
        console.log(`Job ID: ${jobId}`);
        console.log('Responses:', responses);
        console.log('Screening Counters:', screeningCounters);

        let degreeScore = screeningCounters.degree || 0;
        let experienceScore = screeningCounters.experience || 0;
        let certificationScore = screeningCounters.certification || 0;
        let hardSkillsScore = screeningCounters.hardSkill || 0;
        let softSkillsScore = screeningCounters.softSkill || 0;
        let workSetupScore = screeningCounters.work_setup > 0; // Boolean
        let availabilityScore = screeningCounters.availability > 0; // Boolean

        // Calculate total score
        const totalScore = degreeScore + experienceScore + certificationScore + hardSkillsScore + softSkillsScore;
        const totalScoreCalculatedAt = new Date().toISOString();
        
        console.log(`Calculated total score: ${totalScore}`);
        console.log(`Total score calculated at: ${totalScoreCalculatedAt}`);

        // Insert into database
        const { data, error } = await supabase
            .from('applicant_initialscreening_assessment')
            .insert([
                {
                    userId: userId,
                    jobId: jobId,
                    degreeScore: degreeScore,
                    experienceScore: experienceScore,
                    certificationScore: certificationScore,
                    hardSkillsScore: hardSkillsScore,
                    softSkillsScore: softSkillsScore,
                    workSetupScore: workSetupScore,
                    availabilityScore: availabilityScore,
                    totalScore: totalScore,
                    totalScoreCalculatedAt: totalScoreCalculatedAt,
                    resume_url: resumeUrl // Pass the resume URL here
                }
            ]);

        if (error) {
            console.error('Error saving screening scores:', error);
            throw new Error('Error saving screening scores.');
        }

        console.log('Screening scores saved successfully for user:', userId);
        return "Thank you for answering, this marks the end of the initial screening process. We have forwarded your resume to the department's Line Manager, and we will notify you once a decision has been made.";
    } catch (error) {
        console.error('Error in saveScreeningScores:', error);
        return 'An error occurred while saving your screening scores.';
    }
},

// File upload handler in your controller
handleFileUpload: async function (req, res) {
    try {
        console.log('Starting file upload process...');
        
        const userId = req.session.userID;
        console.log(`User ID: ${userId}`);

        if (!req.files || !req.files.file) {
            console.log('No file uploaded.');
            return res.status(400).send('No file uploaded.');
        }

        const file = req.files.file;
        console.log(`File received: ${file.name}, Type: ${file.mimetype}, Size: ${file.size} bytes`);

        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (!allowedTypes.includes(file.mimetype)) {
            console.log('Invalid file type uploaded.');
            return res.status(400).send('Invalid file type. Please upload a valid file.');
        }

        const maxSize = 5 * 1024 * 1024; // 5 MB
        if (file.size > maxSize) {
            console.log('File size exceeds the 5 MB limit.');
            return res.status(400).send('File size exceeds the 5 MB limit.');
        }

        const uniqueName = `${Date.now()}-${file.name}`;
        const filePath = path.join(__dirname, '../uploads', uniqueName);
        console.log(`Saving file locally: ${filePath}`);

        if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
            console.log('Creating uploads directory...');
            fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
        }

        await file.mv(filePath);
        console.log('File successfully saved locally. Uploading to Supabase...');

        const { error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(uniqueName, fs.readFileSync(filePath), {
                contentType: file.mimetype,
                cacheControl: '3600',
                upsert: false,
            });

        fs.unlinkSync(filePath);
        console.log('Local file deleted after upload to Supabase.');

        if (uploadError) {
            console.error('Error uploading file to Supabase:', uploadError);
            return res.status(500).send('Error uploading file to Supabase.');
        }

        const fileUrl = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${uniqueName}`;
        console.log(`File uploaded successfully: ${fileUrl}`);

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
            console.error('Error inserting file metadata:', insertError);
            return res.status(500).send('Error inserting file metadata into database.');
        }
        console.log('File metadata successfully inserted into database.');

        const { error: updateError } = await supabase
            .from('applicant_initialscreening_assessment')
            .update({ resume_url: fileUrl })
            .eq('userId', userId);

        if (updateError) {
            console.error('Error updating resume URL:', updateError);
            return res.status(500).send('Error updating resume URL.');
        }
        console.log('Resume URL updated successfully in applicant_initialscreening_assessment table.');

        // ✅ Update applicantStatus to "P1 - Awaiting for HR Action"
        const { error: statusUpdateError } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'P1 - Awaiting for HR Action' })
            .eq('userId', userId);

        if (statusUpdateError) {
            console.error('Error updating applicant status:', statusUpdateError);
            return res.status(500).send('Error updating applicant status.');
        }
        console.log('Applicant status updated successfully to P1 - Awaiting for HR Action.');

        // ✅ Send chatbot message after successful upload
        res.status(200).json({
            response: {
                text: "Thank you for answering, this marks the end of the initial screening process. We have forwarded your resume to the department's Line Manager, and we will notify you once a decision has been made."
            }
        });

        console.log('File upload process completed successfully.');

    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).send('Internal Server Error.');
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