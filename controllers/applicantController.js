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
    // Function to render chatbot page with the initial greeting
    getChatbotPage: async function(req, res) {
        try {
            const initialMessage = "Hi! Welcome to Prime Infrastructure's recruitment portal. What position are you going to apply for?";
            const positions = await applicantController.getJobPositionsList();
            console.log('Positions fetched:', positions); // log to see what positions are returned

            const initialResponse = JSON.stringify(`${initialMessage}\nHere are our current job openings:\n${positions.map(pos => `- ${pos}`).join('\n')}\nPlease select a position.`);
            console.log('Initial response:', initialResponse);

            res.render('applicant_pages/chatbot', { initialResponse, errors: {} });
        } catch (error) {
            console.error('Error rendering chatbot page:', error);
            res.status(500).send('Error loading chatbot page');
        }
    },
    
    handleChatbotMessage: async function (req, res) {
        try {
            console.log('Start processing chatbot message');
    
            const userId = req.session.userID;
            const userMessage = req.body.message.toLowerCase();
            const timestamp = new Date().toISOString();
            console.log(`User ID: ${userId}, Message: ${userMessage}, Timestamp: ${timestamp}`);
    
            let botResponse;
            let applicantStage = req.session.applicantStage || 'initial';
            console.log(`Initial Applicant Stage: ${applicantStage}`);
    
            const positions = await applicantController.getJobPositionsList();
            const selectedPosition = positions.find(position => userMessage.includes(position.toLowerCase()));
    
            if (selectedPosition) {
                req.session.selectedPosition = selectedPosition;
                const jobDetails = await applicantController.getJobDetails(selectedPosition);
    
                if (jobDetails) {
                    const certifications = jobDetails.jobreqcertifications
                        ? jobDetails.jobreqcertifications.map(cert => `${cert.jobReqCertificateType}: ${cert.jobReqCertificateDescrpt}`).join(', ')
                        : 'None';
                    const degrees = jobDetails.jobreqdegrees
                        ? jobDetails.jobreqdegrees.map(degree => `${degree.jobReqDegreeType}: ${degree.jobReqDegreeDescrpt}`).join(', ')
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
    
                    botResponse = {
                        text: `You have chosen *${selectedPosition}*. Here are the details:\n` +
                            `Job Title: ${jobDetails.jobTitle}\n` +
                            `Job Description: ${jobDetails.jobDescrpt}\n` +
                            `Certifications: ${certifications}\n` +
                            `Degrees: ${degrees}\n` +
                            `Experiences: ${experiences}\n` +
                            `Hard Skills: ${hardSkills}\n` +
                            `Soft Skills: ${softSkills}\n` +
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
            } else if (req.session.applicantStage === 'job_selection' && userMessage.includes('yes')) {
                const jobId = (await applicantController.getJobDetails(req.session.selectedPosition)).jobId;
    
                if (!req.session.screeningQuestions) {
                    const questions = await applicantController.getInitialScreeningQuestions(jobId);
                    req.session.screeningQuestions = questions;
                    req.session.currentQuestionIndex = 0;
                    req.session.screeningScores = [];
                }
    
                const questions = req.session.screeningQuestions;
                const currentIndex = req.session.currentQuestionIndex;
    
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
                    botResponse = "No screening questions available for this position.";
                }
            } else if (req.session.screeningQuestions) {
                const questions = req.session.screeningQuestions;
                const currentIndex = req.session.currentQuestionIndex || 0;
    
                if (currentIndex < questions.length) {
                    req.session.screeningScores.push({ question: questions[currentIndex].text, answer: userMessage });
                    botResponse = {
                        text: questions[currentIndex].text,
                        buttons: [
                            { text: 'Yes', value: 1 },
                            { text: 'No', value: 0 }
                        ]
                    };
                    req.session.currentQuestionIndex = currentIndex + 1;
                } else {
                    await applicantController.saveScreeningScores(userId, req.session.selectedPosition, req.session.screeningScores);
                    botResponse = {
                        text: "After answering the questions, kindly upload your resume for us to review.\nPlease press the button below to upload your resume.",
                        buttons: [
                            { text: 'Upload a File', type: 'file_upload', action: 'uploadResume' }
                        ]
                    };
                    req.session.screeningQuestions = null;
                    req.session.currentQuestionIndex = null;
                }
            } else if (req.body.file) {
                await this.handleFileUpload(req, res);
                return;
            } else {
                botResponse = { text: "I'm sorry, I didn't understand that. How can I help you?", buttons: [] };
            }
    
            res.status(200).json({ response: botResponse });
        } catch (error) {
            console.error('Error processing chatbot message:', error);
            res.status(500).json({ response: 'Sorry, I am having trouble understanding that.' });
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
            ...sortedSkillsQuery.map(s => ({
                type: s.jobReqSkillType.toLowerCase(),
                text: `To assess your ${s.jobReqSkillType.toLowerCase()} skills, do you have ${s.jobReqSkillName}?`,
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


// Function to process screening questions and include Yes/No buttons
handleScreeningQuestions: function (questionObj) {
    const questionText = questionObj.question;
    const buttons = questionObj.options.map(option => {
        return { type: 'postback', title: option, payload: option }; // For interactive buttons
    });

    return {
        text: `${questionText}\nPlease select one of the following options:`,
        buttons: buttons
    };
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

    // Function to fetch job details from the db
// Function to fetch detailed job information, including required certifications, degrees, experiences, and skills
getJobDetails: async function(jobTitle) {
    try {
        const { data: jobDetails, error } = await supabase
            .from('jobpositions')
            .select(`
                jobId, jobTitle, jobDescrpt,
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

    saveScreeningScores: async function (userId, jobId, responses, resumeUrl) {
        try {

            console.log('Saving screening scores for user:', userId);

            let degreeScore = 0;
            let experienceScore = 0;
            let certificationScore = 0;
            let hardSkillsScore = 0;
            let softSkillsScore = 0;
            let workSetupScore = false;
            let availabilityScore = false;
    
            // Process responses
            responses.forEach(response => {
                console.log(`Processing response: ${response.type} -> ${response.value}`);
                if (response.type === 'degree' && response.value === 1) {
                    degreeScore++;
                } else if (response.type === 'experience' && response.value === 1) {
                    experienceScore++;
                } else if (response.type === 'certification' && response.value === 1) {
                    certificationScore++;
                } else if (response.type === 'hard skills' && response.value === 1) {
                    hardSkillsScore++;
                } else if (response.type === 'soft skills' && response.value === 1) {
                    softSkillsScore++;
                } else if (response.type === 'work_setup') {
                    workSetupScore = response.value === 1;
                } else if (response.type === 'availability') {
                    availabilityScore = response.value === 1;
                }
            });
    
            // Calculate total score
            const totalScore = degreeScore + experienceScore + certificationScore + hardSkillsScore + softSkillsScore;
            const totalScoreCalculatedAt = new Date().toISOString();
            console.log(`Calculated total score: ${totalScore}`);

    
            // Insert into database
            const { error } = await supabase
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
                        resume_url: resumeUrl
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
    

    // Function to calculate weighted scores for screening answers
    // calculateWeightedScores: async function(answers, selectedPosition, screeningQuestions) {
    //     if (!screeningQuestions || screeningQuestions.length === 0) {
    //         return { weightedScores: [], result: 'fail' };
    //     }
    
    //     const jobDetails = await chatbotController.getJobDetails(selectedPosition);
    
    //     const weightings = {
    //         degreeRelevance: 1.5,  // Degree-related questions are weighted higher
    //         softSkills: 1,         // Soft skills-related questions have a standard weight
    //     };
    
    //     let totalScore = 0;
    //     const weightedScores = answers.map((answer, index) => {
    //         const question = screeningQuestions[index];
    //         let weight = 1; // Default weight
    
    //         if (question.toLowerCase().includes('degree required')) {
    //             weight = weightings.degreeRelevance;  
    //         } else if (question.toLowerCase().includes('experience') || question.toLowerCase().includes('skill')) {
    //             weight = weightings.softSkills;  
    //         }
    
    //         const weightedScore = answer * weight;
    //         totalScore += weightedScore;
    
    //         return weightedScore;
    //     });
    
    //     // Calculate average score and determine pass/fail
    //     const averageScore = totalScore / screeningQuestions.length;
    //     const result = averageScore >= 3 ? 'pass' : 'fail';  // Assume a threshold of 3 to pass
    
    //     return { weightedScores, result };
    // },    

    
// File upload handler in your controller
handleFileUpload: async function(req, res) {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).send('No file uploaded.');
        }

        const file = req.files.file;
        const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];

        if (!allowedTypes.includes(file.mimetype)) {
            return res.status(400).send('Invalid file type. Please upload a PDF, PNG, or JPEG.');
        }

        const maxSize = 5 * 1024 * 1024; // 5 MB
        if (file.size > maxSize) {
            return res.status(400).send('File size exceeds the 5 MB limit.');
        }

        const uniqueName = `${Date.now()}-${file.name}`;
        const filePath = path.join(__dirname, '../uploads', uniqueName);

        if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
            fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
        }

        await file.mv(filePath);

        // Upload file to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(uniqueName, fs.readFileSync(filePath), {
                contentType: file.mimetype,
                cacheControl: '3600',
                upsert: false,
            });

        fs.unlinkSync(filePath);

        if (uploadError) {
            console.error('Error uploading file to Supabase:', uploadError);
            return res.status(500).send('Error uploading file to Supabase.');
        }

        const fileUrl = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${uploadData.path}`;

        // Insert file metadata into user_files table
        const { error: insertError } = await supabase
            .from('user_files')
            .insert([{
                userId: req.body.userId,
                file_name: uniqueName,
                file_url: fileUrl,
                uploaded_at: new Date(),
                file_size: file.size,
            }]);

        if (insertError) {
            console.error('Error inserting file metadata:', insertError);
            return res.status(500).send('Error inserting file metadata into database.');
        }

        // Update applicant_initialscreening_assessment with resume URL
        const { error: updateError } = await supabase
            .from('applicant_initialscreening_assessment')
            .update({ resume_url: fileUrl })
            .eq('userId', req.body.userId);

        if (updateError) {
            console.error('Error updating resume URL:', updateError);
            return res.status(500).send('Error updating resume URL.');
        }

        res.send({ fileUrl });

    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).send('Error uploading file.');
    }
},

// handleFileUpload: async function(req, res) {
//     try {
//         // Check if file is uploaded
//         if (!req.files || !req.files.file) {
//             return res.status(400).send('No file uploaded.');
//         }

//         const file = req.files.file;
        
//         // Check if user is authenticated, if not, use 'anonymous'
//         const userId = req.body.userId || 'anonymous'; // If userId is not provided, mark as 'anonymous'

//         // Define the local file path
//         const filePath = path.join(__dirname, '../uploads', file.name); // Use the uploads folder path

//         // Ensure the uploads folder exists
//         if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
//             fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
//         }

//         // Save the file to the server locally
//         await file.mv(filePath);

//         // Upload file to Supabase Storage
//         const { data, error } = await supabase.storage
//             .from('uploads') // Your Supabase bucket name
//             .upload(file.name, file.data, {
//                 cacheControl: '3600',  // Cache control header
//                 upsert: false,         // Prevent overwriting files with the same name
//             });

//         if (error) {
//             console.error('Error uploading file to Supabase:', error);
//             return res.status(500).send('Error uploading file to Supabase.');
//         }

//         // Generate the public URL for the uploaded file
//         const fileUrl = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${data.Key}`; // Replace with your actual Supabase URL
        
//         // Insert file metadata into the database (optional)
//         const { data: insertedFile, error: insertError } = await supabase
//             .from('user_files') // Your table for storing file metadata
//             .insert([{
//                 userId: userId,     // User who uploaded the file (anonymous or authenticated)
//                 file_name: file.name, // File name
//                 file_url: fileUrl,    // Public URL of the uploaded file
//                 uploaded_at: new Date(),
//                 file_size: file.size  // File size in bytes
//             }]);

//         if (insertError) {
//             console.error('Error inserting file metadata:', insertError);
//             return res.status(500).send('Error inserting file metadata into database.');
//         }

//         // Return a success message with the file URL
//         res.send(fileUrl); // Send back the file URL instead of just a success message

//     } catch (error) {
//         console.error('Error uploading file:', error);
//         res.status(500).send('Error uploading file.');
//     }
// },


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