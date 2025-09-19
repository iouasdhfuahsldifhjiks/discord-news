document.addEventListener('DOMContentLoaded', function() {
    // DOM
    const newsForm = document.getElementById('newsForm');
    const contentTextarea = document.getElementById('content');
    const channelSelect = document.getElementById('channel');
    const roleSelect = document.getElementById('role');
    const attachmentsInput = document.getElementById('attachments');
    const previewContent = document.getElementById('previewContent');
    const scheduleCheckbox = document.getElementById('schedule');
    const scheduleDate = document.getElementById('scheduleDate');
    const addButtonBtn = document.getElementById('addButton');
    const buttonsContainer = document.getElementById('buttonsContainer');
    const filePreview = document.getElementById('filePreview');

    const useEmbed = document.getElementById('useEmbed');
    const embedFields = document.getElementById('embedFields');
    const embedTitle = document.getElementById('embedTitle');
    const embedColor = document.getElementById('embedColor');
    const embedColorHex = document.getElementById('embedColorHex');

    let currentFiles = [];

    // init
    updatePreview();

    // handlers
    contentTextarea.addEventListener('input', updatePreview);
    channelSelect.addEventListener('change', updatePreview);
    roleSelect.addEventListener('change', updatePreview);
    attachmentsInput.addEventListener('change', handleFileSelect);
    scheduleCheckbox.addEventListener('change', toggleScheduler);
    addButtonBtn.addEventListener('click', addButtonRow);

    useEmbed.addEventListener('change', () => {
        embedFields.style.display = useEmbed.checked ? 'block' : 'none';
        updatePreview();
    });

    // sync color inputs
    embedColor.addEventListener('input', () => {
        embedColorHex.value = embedColor.value;
        updatePreview();
    });
    embedColorHex.addEventListener('input', () => {
        let v = embedColorHex.value.trim();
        if (!v.startsWith('#')) v = '#' + v;
        if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
            embedColor.value = v;
            updatePreview();
        }
    });

    // Обработчики для переключателей позиции вложений
    document.querySelectorAll('input[name="attachmentPosition"]').forEach(radio => {
        radio.addEventListener('change', updatePreview);
    });

    function getCSRFToken() {
        const el = document.querySelector('input[name="_csrf"]');
        return el ? el.value : '';
    }

    // submit
    newsForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const submitBtn = this.querySelector('button[type="submit"]');
        const progress = document.querySelector('.progress');
        const progressBar = document.querySelector('.progress-bar');
        const originalText = submitBtn.innerHTML;

        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Отправка...';
            progress.style.display = 'block';

            const formData = new FormData(newsForm);
            const attachmentPosition = document.querySelector('input[name="attachmentPosition"]:checked').value;

            // buttons -> JSON
            formData.set('buttons', JSON.stringify(getButtonsData()));
            formData.set('attachmentPosition', attachmentPosition);

            // embed -> JSON (если включён)
            if (useEmbed.checked) {
                const embedObj = {
                    title: (embedTitle.value || '').trim() || undefined,
                    description: (contentTextarea.value || '').trim() || undefined,
                    color: (embedColorHex.value || '#2f3136').trim()
                };
                formData.set('embed', JSON.stringify(embedObj));
            } else {
                formData.delete('embed');
            }

            // optional header csrf
            const csrf = getCSRFToken();
            const headers = csrf ? { 'X-CSRF-Token': csrf } : undefined;

            const response = await fetch('/api/send-news', {
                method: 'POST',
                headers,
                body: formData
            });


            let result;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                result = await response.json();
            } else {
                const text = await response.text();
                showModal('❌ Ошибка', `Сервер вернул ошибку: ${escapeHtml(text)}`);
                progress.style.display = 'none';
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
                return;
            }


            // Завершаем прогресс-бар
            progressBar.style.width = '100%';

            if (result.success) {
                showModal('✅ Успех', result.message);
                resetForm();
                setTimeout(() => {
                    progress.style.display = 'none';
                    window.location.reload();
                }, 1200);
            } else {
                showModal('❌ Ошибка', result.error || 'Произошла ошибка при отправке');
                progress.style.display = 'none';
            }
        } catch (error) {
            console.error('Ошибка:', error);
            showModal('❌ Ошибка', 'Произошла ошибка при отправке');
            progress.style.display = 'none';
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    });

    // preview
    function updatePreview() {
        const content = contentTextarea.value || '';
        const roleId = roleSelect.value;
        const attachmentPosition = document.querySelector('input[name="attachmentPosition"]:checked').value;

        let previewHtml = '';

        // role preview (human readable)
        if (roleId) {
            const roleName = roleId === 'everyone'
                ? '@everyone'
                : roleSelect.options[roleSelect.selectedIndex].text;
            previewHtml += `<p class="mb-1"><span class="role-mention">${roleName}</span></p>`;
        }

        // Если вложения должны быть в начале и есть файлы
        if (attachmentPosition === 'start' && currentFiles.length > 0) {
            previewHtml += renderFilesPreview();
        }

        // if embed -> show embed block only (no duplicate plain text)
        if (useEmbed.checked) {
            const color = (embedColorHex.value || '#2f3136').trim();
            const title = (embedTitle.value || '').trim();
            previewHtml += `
                <div class="embed-preview" style="border-left-color:${sanitize(color)}">
                    ${title ? `<div class="embed-title">${escapeHtml(title)}</div>` : ''}
                    <div class="embed-desc">${safeMarkdown(content) || '<span class="text-muted">Описание пустое</span>'}</div>
                </div>
            `;
        } else {
            // plain markdown
            previewHtml += safeMarkdown(content) || '<p class="text-muted">Текст появится здесь...</p>';
        }

        // Если вложения должны быть в конце и есть файлы
        if (attachmentPosition === 'end' && currentFiles.length > 0) {
            previewHtml += renderFilesPreview();
        }

        // buttons
        const buttons = getButtonsData();
        if (buttons.length > 0) {
            previewHtml += '<div class="mt-3"><strong>Кнопки:</strong><div class="mt-2">';
            buttons.forEach(btn => {
                if (btn.label && btn.url) {
                    previewHtml += `<a href="${sanitize(btn.url)}" class="button" target="_blank">${escapeHtml(btn.label)}</a>`;
                }
            });
            previewHtml += '</div></div>';
        }

        previewContent.innerHTML = previewHtml || '<p class="text-muted">Здесь будет отображаться предпросмотр...</p>';
    }

    // Новая функция для рендеринга превью файлов
    function renderFilesPreview() {
        let filesHtml = '<div class="mt-3"><strong>Вложения:</strong><div class="d-flex flex-wrap mt-2">';
        currentFiles.forEach(file => {
            if (file.type.startsWith('image/')) {
                filesHtml += `<img src="${URL.createObjectURL(file)}" class="upload-preview" alt="${escapeHtml(file.name)}">`;
            } else {
                filesHtml += `
                    <div class="file-preview-item">
                        <i class="bi bi-file-earmark"></i>
                        <span>${escapeHtml(file.name)}</span>
                    </div>
                `;
            }
        });
        filesHtml += '</div></div>';
        return filesHtml;
    }

    function handleFileSelect(event) {
        const files = Array.from(event.target.files);
        currentFiles = files;

        filePreview.innerHTML = '';

        files.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-preview-item';

            if (file.type.startsWith('image/')) {
                fileItem.innerHTML = `
                    <img src="${URL.createObjectURL(file)}" class="upload-preview" alt="${escapeHtml(file.name)}">
                    <span>${escapeHtml(file.name)} (${formatFileSize(file.size)})</span>
                `;
            } else {
                fileItem.innerHTML = `
                    <i class="bi bi-file-earmark me-2"></i>
                    <span>${escapeHtml(file.name)} (${formatFileSize(file.size)})</span>
                `;
            }

            filePreview.appendChild(fileItem);
        });

        updatePreview();
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function toggleScheduler() {
        scheduleDate.style.display = scheduleCheckbox.checked ? 'block' : 'none';
        if (scheduleCheckbox.checked) {
            const now = new Date();
            now.setMinutes(now.getMinutes() + 1);
            document.getElementById('scheduledTime').min = now.toISOString().slice(0, 16);
        }
    }

    function addButtonRow() {
        const buttonItem = document.createElement('div');
        buttonItem.className = 'button-item mb-2 fade-in';
        buttonItem.innerHTML = `
            <div class="input-group">
                <input type="text" class="form-control" placeholder="Текст кнопки" maxlength="80">
                <input type="url" class="form-control" placeholder="https://example.com">
                <button type="button" class="btn btn-danger remove-btn">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;

        buttonsContainer.appendChild(buttonItem);

        buttonItem.querySelector('.remove-btn').addEventListener('click', function() {
            buttonItem.remove();
            updatePreview();
        });

        buttonItem.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', updatePreview);
        });
    }

    function getButtonsData() {
        const buttons = [];
        document.querySelectorAll('.button-item').forEach(item => {
            const labelInput = item.querySelector('input[type="text"]');
            const urlInput = item.querySelector('input[type="url"]');

            if (labelInput.value && urlInput.value) {
                buttons.push({
                    label: labelInput.value,
                    url: urlInput.value
                });
            }
        });
        return buttons.slice(0, 5);
    }

    function showModal(title, message) {
        const modalBody = document.getElementById('modalBody');
        modalBody.innerHTML = `
            <h5>${title}</h5>
            <p>${message}</p>
        `;

        const modal = new bootstrap.Modal(document.getElementById('resultModal'));
        modal.show();
    }

    function resetForm() {
        contentTextarea.value = '';
        roleSelect.value = '';
        attachmentsInput.value = '';
        currentFiles = [];
        filePreview.innerHTML = '';
        useEmbed.checked = false;
        embedFields.style.display = 'none';
        embedTitle.value = '';
        embedColor.value = '#5865f2';
        embedColorHex.value = '#5865f2';
        document.querySelector('input[name="attachmentPosition"][value="start"]').checked = true;
        buttonsContainer.innerHTML = `
            <div class="button-item mb-2">
                <div class="input-group">
                    <input type="text" class="form-control" placeholder="Текст кнопки" maxlength="80">
                    <input type="url" class="form-control" placeholder="https://example.com">
                    <button type="button" class="btn btn-danger remove-btn"><i class="bi bi-trash"></i></button>
                </div>
            </div>
        `;
        scheduleCheckbox.checked = false;
        scheduleDate.style.display = 'none';

        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                this.closest('.button-item').remove();
                updatePreview();
            });
        });

        document.querySelectorAll('.button-item input').forEach(input => {
            input.addEventListener('input', updatePreview);
        });

        updatePreview();
    }

    function safeMarkdown(text) {
        try {
            return marked.parse(text || '');
        } catch {
            return `<pre class="mb-0">${escapeHtml(text || '')}</pre>`;
        }
    }

    function sanitize(s) {
        // для атрибутов (href, style)
        try { return String(s).replace(/["'><]/g, ''); } catch { return s; }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // spinner style
    const style = document.createElement('style');
    style.textContent = `
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
});