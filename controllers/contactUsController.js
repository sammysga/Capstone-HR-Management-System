const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');

// Create email transporter
const createTransporter = () => {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
};

// Validation rules for contact form
const contactValidationRules = () => {
    return [
        body('firstName')
            .notEmpty()
            .withMessage('First name is required')
            .isLength({ min: 2, max: 50 })
            .withMessage('First name must be between 2 and 50 characters')
            .matches(/^[a-zA-Z\s]+$/)
            .withMessage('First name can only contain letters and spaces'),
        
        body('lastName')
            .notEmpty()
            .withMessage('Last name is required')
            .isLength({ min: 2, max: 50 })
            .withMessage('Last name must be between 2 and 50 characters')
            .matches(/^[a-zA-Z\s]+$/)
            .withMessage('Last name can only contain letters and spaces'),
        
        body('email')
            .isEmail()
            .withMessage('Please enter a valid email address')
            .normalizeEmail(),
        
        body('inquiry')
            .notEmpty()
            .withMessage('Please select an inquiry type')
            .isIn(['general', 'support', 'feedback', 'business'])
            .withMessage('Invalid inquiry type selected'),
        
        body('subject')
            .notEmpty()
            .withMessage('Subject is required')
            .isLength({ min: 5, max: 200 })
            .withMessage('Subject must be between 5 and 200 characters'),
        
        body('message')
            .notEmpty()
            .withMessage('Message is required')
            .isLength({ min: 10, max: 2000 })
            .withMessage('Message must be between 10 and 2000 characters')
    ];
};

// Render contact form page - FIXED: All variables defined
const getContactForm = (req, res) => {
    res.render('applicant_pages/contactform', {
        title: 'Contact Us - Company ABC',
        errors: {},           // Empty errors object
        formData: {},         // Empty form data object
        success: false        // No success message initially
    });
};

// Handle contact form submission - FIXED: All variables defined
const handleContactForm = async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        
        if (!errors.isEmpty()) {
            const errorMessages = {};
            errors.array().forEach(error => {
                errorMessages[error.path] = error.msg;
            });
            
            return res.render('applicant_pages/contactform', {
                title: 'Contact Us - Company ABC',
                errors: errorMessages,    // Validation errors
                formData: req.body,       // Keep form data
                success: false            // No success message
            });
        }

        const { firstName, lastName, email, inquiry, subject, message } = req.body;

        // Create email transporter
        const transporter = createTransporter();

        // Email content for admin notification
        const adminEmailContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #07ACB9; color: white; padding: 20px; text-align: center;">
                    <h2>New Contact Form Submission</h2>
                </div>
                
                <div style="padding: 20px; background-color: #f8f9fa;">
                    <h3 style="color: #333;">Contact Details</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">Name:</td>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${firstName} ${lastName}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">Email:</td>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${email}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">Inquiry Type:</td>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${inquiry.charAt(0).toUpperCase() + inquiry.slice(1)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">Subject:</td>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${subject}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">Date:</td>
                            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${new Date().toLocaleString()}</td>
                        </tr>
                    </table>
                    
                    <h3 style="color: #333; margin-top: 30px;">Message</h3>
                    <div style="background-color: white; padding: 15px; border-radius: 5px; border-left: 4px solid #07ACB9;">
                        ${message.replace(/\n/g, '<br>')}
                    </div>
                </div>
                
                <div style="background-color: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
                    <p>This email was sent from your website contact form.</p>
                </div>
            </div>
        `;

        // Email content for user confirmation
        const userEmailContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #07ACB9; color: white; padding: 20px; text-align: center;">
                    <h2>Thank You for Contacting Us!</h2>
                </div>
                
                <div style="padding: 20px; background-color: #f8f9fa;">
                    <p>Dear ${firstName},</p>
                    
                    <p>Thank you for reaching out to us. We have received your message and will get back to you as soon as possible.</p>
                    
                    <h3 style="color: #333;">Your Message Details:</h3>
                    <div style="background-color: white; padding: 15px; border-radius: 5px; border-left: 4px solid #07ACB9;">
                        <p><strong>Subject:</strong> ${subject}</p>
                        <p><strong>Inquiry Type:</strong> ${inquiry.charAt(0).toUpperCase() + inquiry.slice(1)}</p>
                        <p><strong>Date Submitted:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                    
                    <p>If you have any urgent concerns, please don't hesitate to contact us directly at:</p>
                    <ul>
                        <li>Email: iscap2251@gmail.com</li>
                        <li>Phone: +63 (2) 8888-8888</li>
                    </ul>
                </div>
                
                <div style="background-color: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
                    <p>Company ABC Capital, Inc.</p>
                    <p>Three E-Com Center, Pasay, Manila</p>
                </div>
            </div>
        `;

        // Send email to admin
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Send to the same email (iscap2251@gmail.com)
            subject: `New Contact Form: ${subject}`,
            html: adminEmailContent,
            replyTo: email // Allow admin to reply directly to the user
        });

        // Send confirmation email to user
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Thank you for contacting Company ABC',
            html: userEmailContent
        });

        console.log('Contact form emails sent successfully');

        // Render success page - FIXED: All variables defined
        res.render('applicant_pages/contactform', {
            title: 'Contact Us - Company ABC',
            errors: {},           // No errors
            formData: {},         // Clear form data on success
            success: true         // Show success message
        });

    } catch (error) {
        console.error('Error sending contact form email:', error);
        
        // Render error page - FIXED: All variables defined
        res.render('applicant_pages/contactform', {
            title: 'Contact Us - Company ABC',
            errors: { 
                general: 'Sorry, there was an error sending your message. Please try again later.' 
            },
            formData: req.body,   // Keep form data
            success: false        // No success message
        });
    }
};

module.exports = {
    getContactForm,
    handleContactForm,
    contactValidationRules
};