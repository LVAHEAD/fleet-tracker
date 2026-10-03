/**
 * Блокнот ФЕТАТ: слайдер-панель справа с формой и списком записей.
 * Вызов: Notebook.init() при загрузке страницы.
 */

const Notebook = (() => {
  let isOpen = false;
  const panelId = "notebook-panel";
  const listContainerId = "notebook-list";

  /**
   * Создаёт HTML слайдер-панели и вставляет в body.
   */
  function createPanel() {
    const panel = document.createElement("div");
    panel.id = panelId;
    panel.className = "notebook-panel";
    panel.innerHTML = `
      <div class="notebook-header">
        <h3>Блокнот</h3>
        <button class="notebook-close" title="Закрыть">×</button>
      </div>
      <div class="notebook-form">
        <input type="text" id="notebook-title" placeholder="Название" maxlength="200">
        <select id="notebook-category">
          <option value="Thought">Мысль</option>
          <option value="Bug">Баг</option>
          <option value="Feature">Фича</option>
        </select>
        <textarea id="notebook-description" placeholder="Описание..." maxlength="1000"></textarea>
        <div class="notebook-image-upload">
          <label>Скриншот (Ctrl+V):</label>
          <div id="notebook-image-zone" class="image-zone">
            Вставить или перетащить сюда
          </div>
          <img id="notebook-preview" src="" style="display:none; max-width:100%; margin-top:8px;">
        </div>
        <button id="notebook-submit" class="btn-primary">Добавить</button>
      </div>
      <div class="notebook-list-header">
        <h4>Последние записи</h4>
        <select id="notebook-filter">
          <option value="">Все</option>
          <option value="Bug">Баги</option>
          <option value="Feature">Фичи</option>
          <option value="Thought">Мысли</option>
        </select>
      </div>
      <div id="${listContainerId}" class="notebook-list"></div>
    `;
    document.body.appendChild(panel);
    attachListeners();
    loadList();
  }

  /**
   * Загружает список записей с сервера и отрисовывает.
   */
  async function loadList() {
    const category = document.getElementById("notebook-filter")?.value;
    const url = category
      ? `/api/notebook?limit=10&category=${encodeURIComponent(category)}`
      : "/api/notebook?limit=10";

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.error("notebook list error:", resp.status);
        return;
      }
      const data = await resp.json();
      renderList(data.items || []);
    } catch (e) {
      console.error("notebook load error:", e);
    }
  }

  /**
   * Отрисовывает список записей с миниатюрами.
   */
  function renderList(items) {
    const container = document.getElementById(listContainerId);
    if (!container) return;

    if (!items.length) {
      container.innerHTML = '<p class="notebook-empty">Нет записей</p>';
      return;
    }

    container.innerHTML = items
      .map((item) => {
        const thumb = item.thumbnail
          ? `<img src="data:image/png;base64,${item.thumbnail}" class="notebook-thumb">`
          : '<div class="notebook-thumb-placeholder">📄</div>';
        const date = new Date(item.created_at).toLocaleDateString("ru-RU");
        return `
          <div class="notebook-item" data-id="${item.id}">
            <div class="notebook-item-thumb">${thumb}</div>
            <div class="notebook-item-info">
              <div class="notebook-item-title">${escapeHtml(item.title)}</div>
              <div class="notebook-item-meta">
                <span class="notebook-category notebook-cat-${item.category.toLowerCase()}">${item.category}</span>
                <span class="notebook-date">${date}</span>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // Обработчики клика на запись
    container.querySelectorAll(".notebook-item").forEach((el) => {
      el.addEventListener("click", () => showDetail(el.dataset.id));
    });
  }

  /**
   * Показывает полную запись в модалке / панели.
   */
  async function showDetail(id) {
    try {
      const resp = await fetch(`/api/notebook/${id}`);
      if (!resp.ok) return;
      const item = await resp.json();
      showDetailModal(item);
    } catch (e) {
      console.error("notebook detail error:", e);
    }
  }

  /**
   * Модалка с полной информацией о записи.
   */
  function showDetailModal(item) {
    const modal = document.createElement("div");
    modal.className = "notebook-modal-overlay";
    const imgHtml = item.image_data
      ? `<img src="data:image/png;base64,${item.image_data}" style="max-width:100%; margin:16px 0;">`
      : "";
    const date = new Date(item.created_at).toLocaleString("ru-RU");
    modal.innerHTML = `
      <div class="notebook-modal">
        <button class="notebook-modal-close">×</button>
        <h3>${escapeHtml(item.title)}</h3>
        <div class="notebook-modal-meta">
          <span class="notebook-category notebook-cat-${item.category.toLowerCase()}">${item.category}</span>
          <span>${item.author}</span>
          <span>${date}</span>
        </div>
        <div class="notebook-modal-description">
          ${escapeHtml(item.description || "").replace(/\n/g, "<br>")}
        </div>
        ${imgHtml}
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.classList.contains("notebook-modal-close")) {
        modal.remove();
      }
    });
  }

  /**
   * Обработчики формы.
   */
  function attachListeners() {
    // Кнопка открытия панели (вешается на [.] меню)
    // ...

    // Закрытие панели
    document.getElementById("notebook-close")?.addEventListener("click", () => {
      close();
    });

    // Фильтр по категории
    document.getElementById("notebook-filter")?.addEventListener("change", () => {
      loadList();
    });

    // Вставка скриншота по Ctrl+V
    const imageZone = document.getElementById("notebook-image-zone");
    if (imageZone) {
      document.addEventListener("paste", (e) => {
        if (!isOpen) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const blob = item.getAsFile();
            handleImageFile(blob);
            e.preventDefault();
            break;
          }
        }
      });

      // Drag-n-drop
      imageZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        imageZone.classList.add("hover");
      });
      imageZone.addEventListener("dragleave", () => {
        imageZone.classList.remove("hover");
      });
      imageZone.addEventListener("drop", (e) => {
        e.preventDefault();
        imageZone.classList.remove("hover");
        const files = e.dataTransfer?.files;
        if (files && files[0]) {
          handleImageFile(files[0]);
        }
      });
    }

    // Отправка формы
    document.getElementById("notebook-submit")?.addEventListener("click", async () => {
      const title = document.getElementById("notebook-title")?.value.trim();
      const category = document.getElementById("notebook-category")?.value;
      const description = document.getElementById("notebook-description")?.value.trim();
      const preview = document.getElementById("notebook-preview");

      if (!title) {
        alert("Введи название");
        return;
      }

      let imageData = null;
      if (preview && preview.src && preview.style.display !== "none") {
        imageData = preview.src;
      }

      const payload = {
        title,
        category,
        description,
        image_data: imageData,
      };

      try {
        const resp = await fetch("/api/notebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const err = await resp.json();
          alert(`Ошибка: ${err.error}`);
          return;
        }
        // Очищаем форму и перезагружаем список
        document.getElementById("notebook-title").value = "";
        document.getElementById("notebook-description").value = "";
        document.getElementById("notebook-category").value = "Thought";
        preview.src = "";
        preview.style.display = "none";
        loadList();
      } catch (e) {
        alert(`Ошибка: ${e.message}`);
      }
    });
  }

  /**
   * Обработка загруженного файла изображения.
   */
  function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const preview = document.getElementById("notebook-preview");
      if (preview) {
        preview.src = e.target.result;
        preview.style.display = "block";
      }
    };
    reader.readAsDataURL(file);
  }

  /**
   * Экранирование HTML.
   */
  function escapeHtml(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  function open() {
    isOpen = true;
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.add("open");
      loadList();
    }
  }

  function close() {
    isOpen = false;
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.remove("open");
    }
  }

  return {
    init() {
      createPanel();
    },
    open,
    close,
    loadList,
  };
})();

// Инициализируем при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
  Notebook.init();
});
