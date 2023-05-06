/**
 * WikiEdit is a tool for quickly editing content without leaving the page.
 *
 * Documentation: https://www.mediawiki.org/wiki/WikiEdit
 * License: GNU General Public License 3 or later (http://www.gnu.org/licenses/gpl-3.0.html)
 * Author: Felipe Schenone (User:Sophivorus)
 */
window.WikiEdit = {

	elements: 'p, li, dd, caption, th, td',

	init: function () {

		// Only init when viewing
		var action = mw.config.get( 'wgAction' );
		if ( action !== 'view' ) {
			return;
		}

		// Only init in useful namespaces
		// See https://www.mediawiki.org/wiki/Manual:Namespace_constants
		var namespaces = [ 0, 2, 4, 12, 14 ];
		var namespace = mw.config.get( 'wgNamespaceNumber' );
		var talk = namespace % 2; // Talk pages always have odd namespaces
		if ( !namespaces.includes( namespace ) && !talk ) {
			return;
		}

		// Only init in wikitext pages
		var model = mw.config.get( 'wgPageContentModel' );
		if ( model !== 'wikitext' ) {
			return;
		}

		WikiEdit.getPageWikitext().done( WikiEdit.addEditButtons );
	},

	/**
	 * Load interface messages directly from the Wikimedia repository 
	 */
	loadedMessages: false, // Tracking flag
	loadMessages: function () {
		return $.get( '//gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/gadgets/WikiEdit/+/master/wikiedit.js?format=text', function ( data ) {
			var messages;
			mw.messages.set( messages );
		} );
	},

	/**
	 * Load CSS directly from the Wikimedia repository and add it to the DOM
	 */
	loadedCSS: false, // Tracking flag
	loadCSS: function () {
		return $.get( '//gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/gadgets/WikiEdit/+/master/wikiedit.css?format=text', function ( data ) {
			var css = atob( data );
			var $style = $( '<style>' ).html( css );
			$( 'head' ).append( $style );
		} );
	},

	/**
	 * Get the wikitext of the current page
	 */
	getPageWikitext: function () {
		var params = {
			'page': mw.config.get( 'wgPageName' ),
			'action': 'parse',
			'prop': 'wikitext',
			'formatversion': 2,
		};
		return new mw.Api().get( params ).done( function ( data ) {
			var pageWikitext = data.parse.wikitext;
			WikiEdit.pageWikitext = pageWikitext;
		} );
	},

	/**
	 * Add the edit buttons to the supported elements
	 *
	 * The behavior of the buttons is different in Minerva
	 * because on mobile devices there's no hover event
	 */
	addEditButtons: function () {
		var $elements = $( WikiEdit.elements, '#mw-content-text' );
		if ( mw.config.get( 'skin' ) === 'minerva' ) {
			$elements.each( WikiEdit.addEditButton );
			$elements.each( WikiEdit.showEditButton );
		} else {
			$elements.each( WikiEdit.addEditButton );
			$elements.on( 'mouseenter', WikiEdit.showEditButton );
			$elements.on( 'mouseleave', WikiEdit.hideEditButton );
		}
	},

	showEditButton: function () {
		$( this ).find( '.wikiedit-button' ).first().show();
	},

	hideEditButton: function () {
		$( this ).find( '.wikiedit-button' ).first().hide();
	},

	/**
	 * Add edit button
	 */
	addEditButton: function () {
		var $element = $( this );

		var relevantWikitext = WikiEdit.getRelevantWikitext( $element );
		if ( !relevantWikitext ) {
			return;
		}

		// Make the button
		var path = '<path fill="currentColor" d="M16.77 8l1.94-2a1 1 0 0 0 0-1.41l-3.34-3.3a1 1 0 0 0-1.41 0L12 3.23zm-5.81-3.71L1 14.25V19h4.75l9.96-9.96-4.75-4.75z"></path>';
		var icon = '<svg width="14" height="14" viewBox="0 0 20 20">' + path + '</svg>';
		var type = WikiEdit.getElementType( $element );
		var title = mw.message( 'wikiedit-title-edit-' + type );
		var $button = $( '<span hidden class="wikiedit-button noprint" title="' + title + '">' + icon + '</span>' );
		$button.on( 'click', WikiEdit.addEditForm );

		// Add to the DOM
		if ( $element.children( 'ul, ol, dl' ).length ) {
			$element.children( 'ul, ol, dl' ).before( ' ', $button );
		} else {
			$element.append( ' ', $button );
		}
	},

	/**
	 * Add edit form
	 */
	addEditForm: function () {

		// Load the necessary CSS and messages the first time this method is called
		if ( !WikiEdit.loadedCSS ) {
			WikiEdit.loadCSS().done( WikiEdit.addEditForm );
			return;
		}
		if ( !WikiEdit.loadedMessages ) {
			WikiEdit.loadCSS().done( WikiEdit.addEditForm );
			return;
		}
console.log( this );
		var $button = $( this );
		var $element = $button.closest( WikiEdit.elements );
		var $original = $element.clone( true ); // Save it for later

		// Get the relevant wikitext
		var wikitext = WikiEdit.getRelevantWikitext( $element );

		// Make the form
		var $form = $( '<div class="wikiedit-form"></div>' );
		var $input = $( '<div class="wikiedit-form-input" contenteditable="true"></div>' ).text( relevantWikitext );
		var $footer = $( '<div class="wikiedit-form-footer"></div>' );
		var $submit = $( '<button class="wikiedit-form-submit mw-ui-button mw-ui-progressive">Save</button>' );
		var $cancel = $( '<button class="wikiedit-form-cancel mw-ui-button">Cancel</button>' );
		$footer.append( $submit, $cancel );
		$form.append( $input, $footer );

		// Add to the DOM
		$element.html( $form );
		$input.focus();

		// Handle the submit
		$submit.on( 'click', {
			'element': $element,
			'original': $original,
			'wikitext': wikitext
		}, WikiEdit.onSubmit );

		// Handle the cancel
		$cancel.on( 'click', function () {
			$element.replaceWith( $original );
		} );

		return false;
	},

	onSubmit: function ( event ) {
		var $submit = $( this );
		var $footer = $submit.closest( '.wikiedit-form-footer' );
		var $form = $submit.closest( '.wikiedit-form' );
		$footer.text( 'Saving...' );
		var $element = event.data.element;
		var oldWikitext = event.data.wikitext;
		var newWikitext = $form.find( '.wikiedit-form-input' ).prop( 'innerText' ); // jQuery's text() removes line breaks
		if ( oldWikitext === newWikitext ) {
			var $original = event.data.original;
			$element.replaceWith( $original );
			return;
		}

		WikiEdit.pageWikitext = WikiEdit.pageWikitext.replace( oldWikitext, newWikitext );
		var params = {
			'action': 'edit',
			'title': mw.config.get( 'wgPageName' ),
			'text': WikiEdit.pageWikitext,
			'summary': WikiEdit.makeSummary( $element, newWikitext ),
			'tags': 'wikiedit',
		};
		var api = new mw.Api();
		if ( mw.config.get( 'wgUserName' ) ) {
			api.postWithEditToken( params ).done( function () {
				WikiEdit.onSuccess( $element, newWikitext );
			} );
		} else {
			api.login(
				'Anon@WikiEdit',
				'a5ehsatdosjes8spfgdpvisgki20avgs'
			).done( function () {
				api.postWithEditToken( params ).done( function () {
					WikiEdit.onSuccess( $element, newWikitext );
				} );
			} );
		}
	},

	onSuccess: function ( $element, newWikitext ) {
		var params = {
			'action': 'parse',
			'title': mw.config.get( 'wgPageName' ),
			'text': newWikitext,
			'formatversion': 2,
			'prop': 'text',
			'wrapoutputclass': null,
			'disablelimitreport': true,
		};
		new mw.Api().get( params ).done( function ( data ) {
			var text = data.parse.text;
			var html = $( text ).html();
			$element.html( html );
		} );
	},

	/**
	 * Helper method to build an adequate edit summary
	 */
	makeSummary: function ( element, inputWikitext ) {
		var action = 'edit';
		if ( !inputWikitext ) {
			action = 'delete';
		}
		var type = WikiEdit.getElementType( element );
		var link = 'mw:WikiEdit';
		if ( mw.config.get( 'wikiedit-link' ) ) {
			link = mw.config.get( 'wikiedit-link' );
		}
		var summary = mw.message( 'wikiedit-summary-' + action + '-' + type, link ).text();
		return summary;
	},

	/**
	 * Helper method to get the relevant wikitext that corresponds to a given DOM element
	 *
	 * This is the heart of the tool
	 * It's an heuristic method to try to find the relevant wikitext
	 * that corresponds to the DOM element being edited
	 * Since wikitext and HTML are different markups
	 * the only place where they meet is in plain text
	 * so we find the longest fragment of plain text in the HTML
	 * and from there we figure out the boundaries of the relevant wikitext
	 *
	 * @param {jQuery object} jQuery object representing the DOM element being edited
	 * @return {string|null} Wikitext of the element being edited, or null if it can't be found
	 */
	getRelevantWikitext: function ( $element ) {
		var wikitext;

		// Get the text of longest text node
		// because it has the most chances of being unique
		var text = '';
		var $textNodes = $element.contents().filter( function () {
			return this.nodeType === Node.TEXT_NODE;
		} );
		$textNodes.each( function () {
			var nodeText = $( this ).text().trim();
			if ( nodeText.length > text.length ) {
				text = nodeText;
			}
		} );

		// Some elements don't have text nodes
		// for example list items with just a link
		if ( !text ) {
			return;
		}

		// Match all lines that contain the text
		text = text.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ); // Escape special characters
		var regexp = new RegExp( '.*' + text + '.*', 'g' );
		var matches = WikiEdit.pageWikitext.match( regexp );

		// This happens often when the element comes from a template
		if ( !matches ) {
			return;
		}

		// This happens often when the text is very short and accidentally repeats
		if ( matches.length > 1 ) {
			return;
		}

		// If we reach this point, we got our relevant wikitext
		// However, we'll try to clean it up a little
		wikitext = matches[0];

		// Clean up list items
		wikitext = wikitext.replace( /^[*#:]+ */, '' );

		// Clean up template parameters
		wikitext = wikitext.replace( /^\|.*= */, '' );

		// Clean up table captions
		wikitext = wikitext.replace( /^\|\+ */, '' );

		// Clean up table headers
		wikitext = wikitext.replace( /^! */, '' );

		// Clean up table cells and anonymous template parameters
		wikitext = wikitext.replace( /^\| */, '' );

		// In theory this should not happen
		if ( !wikitext ) {
			return;
		}

		// We're done, return the relevant wikitext
		return wikitext;
	},

	/**
     * Helper method to get the type of element
     *
     * @param {jQuery object}
     * @return {string}
     */
    getElementType: function ( $element ) {
		var tag = $element.prop( 'tagName' );
		switch ( tag ) {
			case 'P':
				return 'paragraph';
			case 'LI':
				return 'list-item';
			case 'DD':
				return 'reply';
			case 'CAPTION':
				return 'table-caption';
			case 'TH':
				return 'table-header';
			case 'TD':
				return 'table-data';
		}
	}
};

$( WikiEdit.init );
